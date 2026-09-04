import { config } from '../../shared/config/index.js';
import { logger } from '../../shared/logger/index.js';
import { embed } from '../../shared/ollama/ollama.client.js';

export async function generateEmbedding(text: string): Promise<number[]> {
  const startedAt = Date.now();

  logger.info('Generating Ollama embedding', {
    model: config.ollama.embeddingModel,
    textLength: text.length,
    timeoutMs: config.ollama.requestTimeoutMs,
  });

  try {
    const response = await embed({
      model: config.ollama.embeddingModel,
      input: text,
    });

    const embedding = response.embeddings[0];

    if (!embedding) {
      throw new Error('Ollama returned an empty embedding.');
    }

    logger.info('Ollama embedding completed', {
      model: config.ollama.embeddingModel,
      dimensions: embedding.length,
      durationMs: Date.now() - startedAt,
    });

    return embedding;
  } catch (error: unknown) {
    logger.error('Ollama embedding failed', {
      model: config.ollama.embeddingModel,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
