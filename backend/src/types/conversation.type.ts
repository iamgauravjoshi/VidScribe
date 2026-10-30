import type { AnswerCitation } from './chat.type.js';
import type { LlmProviderId } from './llm.type.js';

export type MessageRole = 'user' | 'assistant';
export type MessageStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface MessageFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ConversationMessageRecord {
  id: number;
  turnId: string;
  role: MessageRole;
  status: MessageStatus;
  content: string;
  citations: AnswerCitation[];
  providerId: LlmProviderId | null;
  modelId: string | null;
  failure: MessageFailure | null;
  generationAttemptCount: number;
  generationExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

export interface ConversationMessageDto {
  id: string;
  turnId: string;
  role: MessageRole;
  status: MessageStatus;
  content: string;
  citations: AnswerCitation[];
  providerId: LlmProviderId | null;
  modelId: string | null;
  failure: MessageFailure | null;
  generationAttemptCount: number;
  generationExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface ConversationDto {
  sourceId: number;
  messages: ConversationMessageDto[];
}

export function toConversationMessageDto(
  message: ConversationMessageRecord,
): ConversationMessageDto {
  return {
    ...message,
    id: String(message.id),
    generationExpiresAt: message.generationExpiresAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    finishedAt: message.finishedAt?.toISOString() ?? null,
  };
}
