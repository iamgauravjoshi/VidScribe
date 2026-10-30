import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { pool } from '../db/postgres.js';
import { withTransaction } from '../db/transaction.js';
import { AppError, ErrorCode } from '../shared/errors/index.js';
import type { AnswerCitation } from '../types/chat.type.js';
import type { LlmProviderId } from '../types/llm.type.js';
import type {
  ConversationMessageRecord,
  MessageRole,
  MessageStatus,
} from '../types/conversation.type.js';

interface ConversationMessageRow {
  id: number;
  turn_id: string;
  role: 'USER' | 'ASSISTANT';
  status: MessageStatus;
  content: string;
  citations: AnswerCitation[];
  model_provider: LlmProviderId | null;
  model_id: string | null;
  generation_attempt_count: number;
  generation_expires_at: Date | null;
  failure_code: string | null;
  failure_message: string | null;
  failure_retryable: boolean;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
  lease_active?: boolean;
}

export interface ConversationSnapshot {
  sourceId: number;
  messages: ConversationMessageRecord[];
}

export type BeginAnswerTurnResult =
  | {
      kind: 'claimed';
      conversationId: number;
      userMessageId: number;
      assistantMessageId: number;
      leaseToken: string;
    }
  | {
      kind: 'in_progress';
      userMessageId: number;
      assistantMessageId: number;
      generationExpiresAt: Date | null;
    }
  | {
      kind: 'completed';
      userMessageId: number;
      assistantMessageId: number;
      answer: string;
      citations: AnswerCitation[];
      providerId: LlmProviderId | null;
      modelId: string | null;
    };

function mapMessage(row: ConversationMessageRow): ConversationMessageRecord {
  const role: MessageRole = row.role === 'USER' ? 'user' : 'assistant';

  return {
    id: row.id,
    turnId: row.turn_id,
    role,
    status: row.status,
    content: row.content,
    citations: row.citations,
    providerId: row.model_provider,
    modelId: row.model_id,
    failure:
      row.status === 'FAILED' && row.failure_code
        ? {
            code: row.failure_code,
            message: row.failure_message ?? 'The answer could not be generated.',
            retryable: row.failure_retryable,
          }
        : null,
    generationAttemptCount: row.generation_attempt_count,
    generationExpiresAt: row.generation_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

const MESSAGE_COLUMNS = `
  id,
  turn_id,
  role,
  status,
  content,
  citations,
  model_provider,
  model_id,
  generation_attempt_count,
  generation_expires_at,
  failure_code,
  failure_message,
  failure_retryable,
  created_at,
  updated_at,
  finished_at
`;

export async function getConversationForSource(sourceId: number): Promise<ConversationSnapshot | null> {
  const result = await pool.query<ConversationMessageRow & { source_id: number }>(
    `
      SELECT
        c.source_id,
        m.id,
        m.turn_id,
        m.role,
        m.status,
        m.content,
        m.citations,
        m.model_provider,
        m.model_id,
        m.generation_attempt_count,
        m.generation_expires_at,
        m.failure_code,
        m.failure_message,
        m.failure_retryable,
        m.created_at,
        m.updated_at,
        m.finished_at
      FROM conversations AS c
      LEFT JOIN messages AS m ON m.conversation_id = c.id
      WHERE c.source_id = $1
      ORDER BY m.id ASC
    `,
    [sourceId],
  );

  if (!result.rows[0]) {
    return null;
  }

  return {
    sourceId: result.rows[0].source_id,
    messages: result.rows
      .filter((row) => row.id !== null)
      .map((row) => mapMessage(row)),
  };
}

export async function beginAnswerTurn(input: {
  sourceId: number;
  turnId: string;
  question: string;
  leaseDurationMs: number;
}): Promise<BeginAnswerTurnResult | null> {
  return withTransaction(async (client) => {
    const conversation = await client.query<{ id: number }>(
      `
        SELECT c.id
        FROM conversations AS c
        INNER JOIN sources AS s ON s.id = c.source_id
        WHERE c.source_id = $1 AND s.processing_status = 'READY'
        FOR UPDATE OF c
      `,
      [input.sourceId],
    );
    const conversationId = conversation.rows[0]?.id;

    if (!conversationId) {
      return null;
    }

    const existing = await client.query<ConversationMessageRow>(
      `
        SELECT ${MESSAGE_COLUMNS},
               (generation_expires_at > NOW()) AS lease_active
        FROM messages
        WHERE conversation_id = $1 AND turn_id = $2
        ORDER BY id
        FOR UPDATE
      `,
      [conversationId, input.turnId],
    );
    const userMessage = existing.rows.find((row) => row.role === 'USER');
    const assistantMessage = existing.rows.find((row) => row.role === 'ASSISTANT');

    if (userMessage && userMessage.content !== input.question) {
      throw new AppError(
        'This request ID is already associated with a different question.',
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        409,
        { turnId: input.turnId },
      );
    }

    if (!userMessage && !assistantMessage) {
      const token = randomUUID();
      const insertedUser = await client.query<{ id: number }>(
        `
          INSERT INTO messages (conversation_id, turn_id, role, status, content, citations, finished_at)
          VALUES ($1, $2, 'USER', 'COMPLETED', $3, '[]'::JSONB, NOW())
          RETURNING id
        `,
        [conversationId, input.turnId, input.question],
      );
      const insertedAssistant = await client.query<{ id: number }>(
        `
          INSERT INTO messages (
            conversation_id,
            turn_id,
            role,
            status,
            content,
            generation_attempt_count,
            generation_token,
            generation_expires_at
          )
          VALUES (
            $1,
            $2,
            'ASSISTANT',
            'PENDING',
            '',
            1,
            $3,
            NOW() + ($4 * INTERVAL '1 millisecond')
          )
          RETURNING id
        `,
        [conversationId, input.turnId, token, input.leaseDurationMs],
      );

      await client.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

      return {
        kind: 'claimed',
        conversationId,
        userMessageId: insertedUser.rows[0].id,
        assistantMessageId: insertedAssistant.rows[0].id,
        leaseToken: token,
      };
    }

    if (!userMessage || !assistantMessage) {
      throw new Error(`Conversation turn ${input.turnId} has an incomplete message pair.`);
    }

    if (assistantMessage.status === 'COMPLETED') {
      return {
        kind: 'completed',
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        answer: assistantMessage.content,
        citations: assistantMessage.citations,
        providerId: assistantMessage.model_provider,
        modelId: assistantMessage.model_id,
      };
    }

    if (assistantMessage.status === 'PENDING' && assistantMessage.lease_active) {
      return {
        kind: 'in_progress',
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        generationExpiresAt: assistantMessage.generation_expires_at,
      };
    }

    if (assistantMessage.status === 'FAILED' && !assistantMessage.failure_retryable) {
      throw new AppError(
        'This answer cannot be retried automatically.',
        ErrorCode.ANSWER_RETRY_NOT_ALLOWED,
        409,
        { turnId: input.turnId },
      );
    }

    const token = randomUUID();
    const claimed = await client.query<{ id: number }>(
      `
        UPDATE messages
        SET status = 'PENDING',
            content = '',
            citations = '[]'::JSONB,
            model_provider = NULL,
            model_id = NULL,
            generation_attempt_count = generation_attempt_count + 1,
            generation_token = $2,
            generation_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
            failure_code = NULL,
            failure_message = NULL,
            failure_retryable = FALSE,
            updated_at = NOW(),
            finished_at = NULL
        WHERE id = $1 AND role = 'ASSISTANT'
        RETURNING id
      `,
      [assistantMessage.id, token, input.leaseDurationMs],
    );

    await client.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

    return {
      kind: 'claimed',
      conversationId,
      userMessageId: userMessage.id,
      assistantMessageId: claimed.rows[0].id,
      leaseToken: token,
    };
  });
}

export async function renewAnswerLease(
  messageId: number,
  leaseToken: string,
  leaseDurationMs: number,
): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE messages
      SET generation_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
          updated_at = NOW()
      WHERE id = $1
        AND role = 'ASSISTANT'
        AND status = 'PENDING'
        AND generation_token = $2
      RETURNING id
    `,
    [messageId, leaseToken, leaseDurationMs],
  );

  return result.rowCount === 1;
}

export async function completeAnswerTurn(input: {
  messageId: number;
  leaseToken: string;
  answer: string;
  citations: AnswerCitation[];
  providerId?: LlmProviderId | null;
  modelId?: string | null;
}): Promise<boolean> {
  return withTransaction(async (client) => {
    const message = await client.query<{ conversation_id: number }>(
      `
        SELECT conversation_id
        FROM messages
        WHERE id = $1
          AND role = 'ASSISTANT'
          AND status = 'PENDING'
          AND generation_token = $2
      `,
      [input.messageId, input.leaseToken],
    );
    const conversationId = message.rows[0]?.conversation_id;

    if (!conversationId) {
      return false;
    }

    // Match source deletion's parent-to-child order: conversation, then message.
    const lockedConversation = await client.query<{ id: number }>(
      'SELECT id FROM conversations WHERE id = $1 FOR UPDATE',
      [conversationId],
    );

    if (!lockedConversation.rows[0]) {
      return false;
    }

    const updated = await client.query<{ conversation_id: number }>(
      `
        UPDATE messages
        SET status = 'COMPLETED',
            content = $3,
            citations = $4::JSONB,
            model_provider = $5,
            model_id = $6,
            generation_token = NULL,
            generation_expires_at = NULL,
            failure_code = NULL,
            failure_message = NULL,
            failure_retryable = FALSE,
            updated_at = NOW(),
            finished_at = NOW()
        WHERE id = $1
          AND role = 'ASSISTANT'
          AND status = 'PENDING'
          AND generation_token = $2
        RETURNING conversation_id
      `,
      [
        input.messageId,
        input.leaseToken,
        input.answer,
        JSON.stringify(input.citations),
        input.providerId ?? null,
        input.modelId ?? null,
      ],
    );
    if (!updated.rows[0]) {
      return false;
    }

    await client.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);
    return true;
  });
}

export async function failAnswerTurn(input: {
  messageId: number;
  leaseToken: string;
  failure: { code: string; message: string; retryable: boolean };
}): Promise<boolean> {
  return withTransaction(async (client: PoolClient) => {
    const message = await client.query<{ conversation_id: number }>(
      `
        SELECT conversation_id
        FROM messages
        WHERE id = $1
          AND role = 'ASSISTANT'
          AND status = 'PENDING'
          AND generation_token = $2
      `,
      [input.messageId, input.leaseToken],
    );
    const conversationId = message.rows[0]?.conversation_id;

    if (!conversationId) {
      return false;
    }

    // Keep the same lock order as completion and source-cascade deletion.
    const lockedConversation = await client.query<{ id: number }>(
      'SELECT id FROM conversations WHERE id = $1 FOR UPDATE',
      [conversationId],
    );

    if (!lockedConversation.rows[0]) {
      return false;
    }

    const updated = await client.query<{ conversation_id: number }>(
      `
        UPDATE messages
        SET status = 'FAILED',
            content = '',
            citations = '[]'::JSONB,
            generation_token = NULL,
            generation_expires_at = NULL,
            failure_code = $3,
            failure_message = $4,
            failure_retryable = $5,
            updated_at = NOW(),
            finished_at = NOW()
        WHERE id = $1
          AND role = 'ASSISTANT'
          AND status = 'PENDING'
          AND generation_token = $2
        RETURNING conversation_id
      `,
      [input.messageId, input.leaseToken, input.failure.code, input.failure.message, input.failure.retryable],
    );
    if (!updated.rows[0]) {
      return false;
    }

    await client.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);
    return true;
  });
}
