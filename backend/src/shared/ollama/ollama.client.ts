/*
                  ┌────────────────────┐
                  │ ollama.client.ts   │
                  │                    │
                  │ HTTP               │
                  │ timeout            │
                  │ AbortController    │
                  │ response parsing   │
                  │ HTTP errors        │
                  └─────────┬──────────┘
                            │
                 ┌──────────┴──────────┐
                 ▼                     ▼
       ollama.service.ts      embedding.service.ts
              │                       │
              ▼                       ▼
          Chat/RAG                 Embeddings
*/

import { config } from '../config/index.js';
import { AppError, ErrorCode } from '../errors/index.js';
import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaEmbedRequest,
  OllamaEmbedResponse,
} from './ollama.types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOllamaChatResponse(value: unknown): value is OllamaChatResponse {
  if (!isRecord(value)) {
    return false;
  }

  const message = value.message;

  return (
    isRecord(message) && typeof message.role === 'string' && typeof message.content === 'string'
  );
}

function isOllamaEmbedResponse(value: unknown): value is OllamaEmbedResponse {
  if (!isRecord(value)) {
    return false;
  }

  const embeddings = value.embeddings;

  return (
    Array.isArray(embeddings) &&
    embeddings.every(
      (embedding): embedding is number[] =>
        Array.isArray(embedding) && embedding.every((value) => typeof value === 'number'),
    )
  );
}

async function makeRequest<T>(
  endpoint: string,
  body: unknown,
  validateResponse: (value: unknown) => value is T,
  operation: 'chat' | 'embedding',
): Promise<T> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, config.ollama.requestTimeoutMs);

  try {
    const response = await fetch(`${config.ollama.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseText = await response.text();

      throw new AppError(
        `Ollama returned HTTP ${response.status}.`,
        response.status >= 500
          ? ErrorCode.OLLAMA_UNAVAILABLE
          : operation === 'chat'
            ? ErrorCode.OLLAMA_GENERATION_FAILED
            : ErrorCode.OLLAMA_EMBEDDING_FAILED,
        response.status >= 500 ? 503 : 502,
        {
          operation,
          status: response.status,
          response: responseText.slice(0, 500),
        },
      );
    }

    const data: unknown = await response.json();

    if (!validateResponse(data)) {
      throw new AppError(
        `Ollama returned an unexpected ${operation} response.`,
        operation === 'chat'
          ? ErrorCode.OLLAMA_GENERATION_FAILED
          : ErrorCode.OLLAMA_EMBEDDING_FAILED,
        502,
        { operation },
      );
    }

    return data;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AppError(`Ollama ${operation} request timed out.`, ErrorCode.OLLAMA_TIMEOUT, 504, {
        operation,
        timeoutMs: config.ollama.requestTimeoutMs,
      });
    }

    if (error instanceof TypeError) {
      throw new AppError('Ollama server is unavailable.', ErrorCode.OLLAMA_UNAVAILABLE, 503, {
        operation,
      });
    }

    throw new AppError(
      `Ollama ${operation} request failed.`,
      operation === 'chat' ? ErrorCode.OLLAMA_GENERATION_FAILED : ErrorCode.OLLAMA_EMBEDDING_FAILED,
      502,
      { operation },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function chat(chatRequest: OllamaChatRequest): Promise<OllamaChatResponse> {
  return makeRequest('/api/chat', chatRequest, isOllamaChatResponse, 'chat');
}

export async function embed(embedRequest: OllamaEmbedRequest): Promise<OllamaEmbedResponse> {
  return makeRequest('/api/embed', embedRequest, isOllamaEmbedResponse, 'embedding');
}
