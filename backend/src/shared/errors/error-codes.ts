/**
 * Application-level error codes.
 *
 * These codes are consumed by the API/client and should remain
 * stable even if the internal implementation changes.
 */
export const ErrorCode = {
  // General
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // YouTube / Video
  INVALID_YOUTUBE_URL: 'INVALID_YOUTUBE_URL',
  VIDEO_NOT_FOUND: 'VIDEO_NOT_FOUND',
  VIDEO_ALREADY_EXISTS: 'VIDEO_ALREADY_EXISTS',
  VIDEO_PROCESSING_FAILED: 'VIDEO_PROCESSING_FAILED',

  // Transcript
  TRANSCRIPT_NOT_AVAILABLE: 'TRANSCRIPT_NOT_AVAILABLE',
  TRANSCRIPT_FETCH_FAILED: 'TRANSCRIPT_FETCH_FAILED',

  // Database
  DATABASE_ERROR: 'DATABASE_ERROR',

  // Embeddings
  EMBEDDING_FAILED: 'EMBEDDING_FAILED',

  // Vector search
  VECTOR_SEARCH_FAILED: 'VECTOR_SEARCH_FAILED',
  NO_RELEVANT_CONTEXT: 'NO_RELEVANT_CONTEXT',

  // Ollama
  OLLAMA_UNAVAILABLE: 'OLLAMA_UNAVAILABLE',
  OLLAMA_TIMEOUT: 'OLLAMA_TIMEOUT',
  OLLAMA_GENERATION_FAILED: 'OLLAMA_GENERATION_FAILED',
  OLLAMA_EMBEDDING_FAILED: 'OLLAMA_EMBEDDING_FAILED',
} as const;

/**
 * Union of all supported application error codes.
 */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
