import type { LlmProviderId } from './llm.type.js';

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
  providerId: LlmProviderId | null;
  modelId: string | null;
}
