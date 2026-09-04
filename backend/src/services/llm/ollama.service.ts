/*
ollama.service.ts
       │
       │ generateAnswer()
       ▼
ollama.client.ts
       │
       ├── timeout
       ├── AbortController
       ├── HTTP status
       ├── response validation
       ├── network error
       │
       ▼
http://localhost:11434
*/

import { config } from '../../shared/config/index.js';
import { logger } from '../../shared/logger/index.js';
import { chat } from '../../shared/ollama/ollama.client.js';

export async function generateAnswer(prompt: string): Promise<string> {
  const startedAt = Date.now();

  logger.info('Starting Ollama chat generation', {
    model: config.ollama.chatModel,
    timeoutMs: config.ollama.requestTimeoutMs,
  });

  try {
    const response = await chat({
      model: config.ollama.chatModel,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      stream: false,
      options: {
        num_predict: 300,
      },
    });

    logger.info('Ollama chat generation completed', {
      model: config.ollama.chatModel,
      durationMs: Date.now() - startedAt,
    });

    return response.message.content;
  } catch (error: unknown) {
    logger.error('Ollama chat generation failed', {
      model: config.ollama.chatModel,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
