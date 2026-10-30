import {
  beginAnswerTurn,
  completeAnswerTurn,
  failAnswerTurn,
  getConversationForSource,
  renewAnswerLease,
} from '../../repositories/conversation.repository.js';
import { getSource } from '../sources/source.service.js';
import { answerQuestion } from '../rag/rag.service.js';
import { config } from '../../shared/config/index.js';
import { AppError, ErrorCode } from '../../shared/errors/index.js';
import { logger } from '../../shared/logger/index.js';
import type { AnswerCitation } from '../../types/chat.type.js';
import type { ConversationDto } from '../../types/conversation.type.js';
import type { LlmProviderId } from '../../types/llm.type.js';
import type { RequestTraceContext } from '../../types/observability.type.js';
import { toConversationMessageDto } from '../../types/conversation.type.js';
import { SourceStatus } from '../../types/source.type.js';

export type AnswerTurnResponse =
  | {
      status: 'PENDING';
      turnId: string;
      userMessageId: string;
      assistantMessageId: string;
    }
  | {
      status: 'COMPLETED';
      turnId: string;
      userMessageId: string;
      assistantMessageId: string;
      answer: string;
      citations: AnswerCitation[];
      providerId: LlmProviderId | null;
      modelId: string | null;
    };

class AnswerLeaseLostError extends Error {
  constructor() {
    super('The answer generation lease is no longer owned by this request.');
    this.name = 'AnswerLeaseLostError';
  }
}

function classifyAnswerFailure(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      retryable:
        error.statusCode >= 500 ||
        error.statusCode === 408 ||
        error.statusCode === 429 ||
        error.code === ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
    };
  }

  return {
    code: 'ANSWER_GENERATION_FAILED',
    message:
      'The answer could not be generated. Check your provider settings and connection, then try again.',
    retryable: true,
  };
}

function startAnswerLeaseHeartbeat(
  messageId: number,
  leaseToken: string,
  trace: RequestTraceContext,
) {
  const leaseDurationMs = config.chat.generationLeaseDurationMs;
  const intervalMs = Math.max(100, Math.floor(leaseDurationMs / 3));
  let leaseLost = false;
  let inFlight: Promise<void> | null = null;

  const timer = setInterval(() => {
    if (inFlight) return;

    inFlight = renewAnswerLease(messageId, leaseToken, leaseDurationMs)
      .then((renewed) => {
        if (!renewed) leaseLost = true;
      })
      .catch((error: unknown) => {
        leaseLost = true;
        logger.warn('Chat answer lease renewal failed', {
          ...trace,
          assistantMessageId: messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        inFlight = null;
      });
  }, intervalMs);

  timer.unref();

  return {
    assertOwned(): void {
      if (leaseLost) throw new AnswerLeaseLostError();
    },
    async stop(): Promise<void> {
      clearInterval(timer);
      await inFlight;
    },
  };
}

function inProgressResponse(input: {
  turnId: string;
  userMessageId: number;
  assistantMessageId: number;
}): AnswerTurnResponse {
  return {
    status: 'PENDING',
    turnId: input.turnId,
    userMessageId: String(input.userMessageId),
    assistantMessageId: String(input.assistantMessageId),
  };
}

export async function getSourceConversation(sourceId: number): Promise<ConversationDto> {
  await getSource(sourceId);
  const conversation = await getConversationForSource(sourceId);

  if (!conversation) {
    throw new AppError('Source conversation was not found.', ErrorCode.SOURCE_NOT_FOUND, 404, {
      sourceId,
    });
  }

  return {
    sourceId: conversation.sourceId,
    messages: conversation.messages.map(toConversationMessageDto),
  };
}

export async function askSourceQuestion(input: {
  sourceId: number;
  turnId: string;
  question: string;
  requestId: string;
}): Promise<AnswerTurnResponse> {
  const trace: RequestTraceContext = {
    requestId: input.requestId,
    sourceId: input.sourceId,
    turnId: input.turnId,
  };
  const claimStartedAt = Date.now();
  const source = await getSource(input.sourceId);

  if (source.status !== SourceStatus.READY) {
    throw new AppError(
      'This source is not ready for questions yet.',
      ErrorCode.SOURCE_NOT_READY,
      409,
      { sourceId: input.sourceId, status: source.status },
    );
  }

  const claim = await beginAnswerTurn({
    ...input,
    leaseDurationMs: config.chat.generationLeaseDurationMs,
  });

  logger.info('Chat answer turn claim resolved', {
    ...trace,
    sourceStatus: source.status,
    outcome: claim?.kind ?? 'missing',
    turnClaimFlowDurationMs: Date.now() - claimStartedAt,
  });

  if (!claim) {
    throw new AppError('Source conversation was not found.', ErrorCode.SOURCE_NOT_FOUND, 404, {
      sourceId: input.sourceId,
    });
  }

  if (claim.kind === 'in_progress') {
    return inProgressResponse({ ...claim, turnId: input.turnId });
  }

  if (claim.kind === 'completed') {
    return {
      status: 'COMPLETED',
      turnId: input.turnId,
      userMessageId: String(claim.userMessageId),
      assistantMessageId: String(claim.assistantMessageId),
      answer: claim.answer,
      citations: claim.citations,
      providerId: claim.providerId,
      modelId: claim.modelId,
    };
  }

  const heartbeat = startAnswerLeaseHeartbeat(claim.assistantMessageId, claim.leaseToken, trace);
  const startedAt = Date.now();

  try {
    const result = await answerQuestion(trace, input.question);
    heartbeat.assertOwned();

    const persistenceStartedAt = Date.now();
    const committed = await completeAnswerTurn({
      messageId: claim.assistantMessageId,
      leaseToken: claim.leaseToken,
      answer: result.answer,
      citations: result.citations,
      providerId: result.providerId,
      modelId: result.modelId,
    });

    if (!committed) {
      throw new AnswerLeaseLostError();
    }

    logger.info('Chat answer persisted', {
      ...trace,
      assistantMessageId: claim.assistantMessageId,
      citationCount: result.citations.length,
      providerId: result.providerId,
      modelId: result.modelId,
      persistenceDurationMs: Date.now() - persistenceStartedAt,
      durationMs: Date.now() - startedAt,
    });

    return {
      status: 'COMPLETED',
      turnId: input.turnId,
      userMessageId: String(claim.userMessageId),
      assistantMessageId: String(claim.assistantMessageId),
      answer: result.answer,
      citations: result.citations,
      providerId: result.providerId,
      modelId: result.modelId,
    };
  } catch (error: unknown) {
    if (error instanceof AnswerLeaseLostError) {
      logger.warn('Chat answer discarded after generation lease was lost', {
        ...trace,
        assistantMessageId: claim.assistantMessageId,
      });
      throw new AppError(
        'This answer is being completed by another request. Refresh the conversation shortly.',
        ErrorCode.ANSWER_IN_PROGRESS,
        409,
        { turnId: input.turnId },
      );
    }

    const failure = classifyAnswerFailure(error);

    try {
      const recorded = await failAnswerTurn({
        messageId: claim.assistantMessageId,
        leaseToken: claim.leaseToken,
        failure,
      });

      if (recorded) {
        logger.error('Chat answer generation failed', {
          ...trace,
          assistantMessageId: claim.assistantMessageId,
          errorCode: failure.code,
          retryable: failure.retryable,
          durationMs: Date.now() - startedAt,
        });
      } else {
        logger.warn('Chat answer failure ignored because the lease is no longer owned', {
          ...trace,
          assistantMessageId: claim.assistantMessageId,
        });
      }
    } catch (recordError: unknown) {
      logger.error('Could not persist chat answer failure', {
        ...trace,
        originalError: failure.message,
        recordError: recordError instanceof Error ? recordError.message : String(recordError),
      });
    }

    throw error;
  } finally {
    await heartbeat.stop();
  }
}
