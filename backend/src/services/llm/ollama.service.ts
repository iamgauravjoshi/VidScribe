import ollama from 'ollama';
import { config } from '../../shared/config/index.js';
import { createOllamaError } from '../../shared/errors/index.js';
import { logger } from '../../shared/logger/index.js';

export async function generateAnswer(prompt: string): Promise<string> {
  const startedAt = Date.now();

  try {
    logger.info('Starting Ollama chat generation', {
      model: config.ollama.chatModel,
      timeoutMs: config.ollama.requestTimeoutMs,
    });

    const response = await ollama.chat({
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
      // signal: controller.signal,
    });

    logger.info('Ollama chat generation completed', {
      model: config.ollama.chatModel,
      durationMs: Date.now() - startedAt,
    });

    return response.message.content;
  } catch (error: unknown) {
    const appError = createOllamaError(error, 'chat');

    logger.error('Ollama chat generation failed', {
      model: config.ollama.chatModel,
      durationMs: Date.now() - startedAt,
      errorCode: appError.code,
    });

    throw appError;
  }
}

// --------------------------------------------------------------------
// --------------------------------------------------------------------

interface OllamaChatResponse {
  message: {
    content: string;
  };
}

async function generateAnswerWithTimeout(prompt: string): Promise<OllamaChatResponse> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, config.ollama.requestTimeoutMs);

  try {
    const response = await fetch(`${config.ollama.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
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
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as OllamaChatResponse;
  } finally {
    clearTimeout(timeout);
  }
}

// const response = await chatWithTimeout(prompt);
