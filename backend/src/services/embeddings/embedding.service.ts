import ollama from 'ollama';
import { config } from '../../shared/config/index.js';
import { createOllamaError } from '../../shared/errors/index.js';
import { logger } from '../../shared/logger/index.js';

interface OllamaEmbedResponse {
  embeddings: number[][];
}

export async function generateEmbedding(text: string): Promise<number[]> {
  // const controller = new AbortController();

  // const timeout = setTimeout(() => {
  //   controller.abort();
  // }, config.ollama.requestTimeoutMs);

  const startedAt = Date.now();

  try {
    logger.info('Generating Ollama embedding', {
      model: config.ollama.embeddingModel,
      textLength: text.length,
    });

    const response = await ollama.embed({
      model: config.ollama.embeddingModel,
      input: text,
      // signal: controller.signal,
    });

    logger.info('Ollama embedding completed', {
      model: config.ollama.embeddingModel,
      durationMs: Date.now() - startedAt,
    });

    return response.embeddings[0];
  } catch (error: unknown) {
    const appError = createOllamaError(error, 'embedding');

    logger.error('Ollama embedding failed', {
      model: config.ollama.embeddingModel,
      durationMs: Date.now() - startedAt,
      errorCode: appError.code,
    });

    throw appError;
  }
  // finally {
  //   clearTimeout(timeout);
  // }
}
