export type SourceStatus = 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';
export type IngestionPhase = 'FETCHING_TRANSCRIPT' | 'CHUNKING' | 'INDEXING' | 'PERSISTING';

export interface SourceFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export interface Source {
  id: number;
  type: 'youtube';
  externalId: string;
  canonicalUrl: string;
  title: string | null;
  status: SourceStatus;
  phase: IngestionPhase | null;
  failure: SourceFailure | null;
  attemptCount: number;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnswerCitation {
  id: string;
  startSeconds: number | null;
  endSeconds: number | null;
  excerpt: string;
  href: string;
}

export interface AnswerResult {
  answer: string;
  citations: AnswerCitation[];
}

export type MessageStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface MessageFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ChatMessage {
  id: string;
  turnId: string;
  role: 'user' | 'assistant';
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

export interface Conversation {
  sourceId: number;
  messages: ChatMessage[];
}

export type ChatTurnResponse =
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

export interface ChatTurnResult {
  turn: ChatTurnResponse;
}

export interface ApplicationHealth {
  status: 'ok' | 'degraded';
  services: {
    database: { status: 'ok' | 'error'; responseTimeMs?: number; error?: string };
    generation: {
      status: 'configured' | 'not_configured' | 'error';
      providerId: LlmProviderId;
      modelId: string;
    };
  };
}

export type LlmProviderId = 'gemini' | 'openai' | 'anthropic' | 'ollama';
export type ThemeMode = 'light' | 'dark';

export interface AiProviderSettings {
  id: LlmProviderId;
  label: string;
  modelId: string;
  requiresApiKey: boolean;
  configured: boolean;
  active: boolean;
}

export interface AiSettings {
  activeProvider: LlmProviderId;
  providers: AiProviderSettings[];
}
