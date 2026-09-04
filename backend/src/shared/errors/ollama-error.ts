import { AppError, ErrorCode } from '../errors/index.js';

export function createOllamaError(error: unknown, operation: 'chat' | 'embedding'): AppError {
  const message = error instanceof Error ? error.message : String(error);

  const normalizedMessage = message.toLowerCase();

  /*
   * AbortController timeout.
   */
  if (
    normalizedMessage.includes('abort') ||
    normalizedMessage.includes('timeout') ||
    normalizedMessage.includes('headers timeout')
  ) {
    return new AppError(`Ollama ${operation} request timed out.`, ErrorCode.OLLAMA_TIMEOUT, 504, {
      operation,
    });
  }

  /*
   * Ollama server is not running or cannot be reached.
   */
  if (
    normalizedMessage.includes('fetch failed') ||
    normalizedMessage.includes('econnrefused') ||
    normalizedMessage.includes('connection refused')
  ) {
    return new AppError('Ollama server is unavailable.', ErrorCode.OLLAMA_UNAVAILABLE, 503, {
      operation,
    });
  }

  /*
   * Generic Ollama failure.
   */
  return new AppError(
    `Ollama ${operation} request failed.`,
    operation === 'chat' ? ErrorCode.OLLAMA_GENERATION_FAILED : ErrorCode.OLLAMA_EMBEDDING_FAILED,
    502,
    {
      operation,
    },
  );
}
