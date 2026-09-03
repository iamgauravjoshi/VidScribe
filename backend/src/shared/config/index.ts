import dotenv from 'dotenv';
import path from 'node:path';

// const envPath = path.resolve(
//   process.cwd().endsWith("backend") ? process.cwd() : path.join(process.cwd(), "backend"),
//   "..",
//   ".env"
// );

// dotenv.config({
//   path: envPath
// });

dotenv.config({
  path: path.resolve(process.cwd(), '../.env'),
});

type NodeEnvironment = 'development' | 'test' | 'production';

/**
 * Retrieves a required environment variable.
 *
 * Throws an error when the variable is missing or empty.
 */
function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function getNumberEnv(name: string, defaultValue?: number): number {
  const value = process.env[name];

  if (!value || value.trim() === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }

    throw new Error(`Missing required environment variable: ${name}`);
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Environment variable ${name} must be a valid number. Received: "${value}"`);
  }

  return parsedValue;
}

function getNodeEnvironment(): NodeEnvironment {
  const value = process.env.NODE_ENV ?? 'development';

  if (value !== 'development' && value !== 'test' && value !== 'production') {
    throw new Error(`NODE_ENV must be one of: development, test, production. Received: "${value}"`);
  }

  return value;
}

export const config = {
  nodeEnv: getNodeEnvironment(),

  server: {
    port: getNumberEnv('BACKEND_PORT', 8000),
  },

  postgres: {
    host: getRequiredEnv('POSTGRES_HOST'),
    port: getNumberEnv('POSTGRES_PORT'),
    database: getRequiredEnv('POSTGRES_DB'),
    user: getRequiredEnv('POSTGRES_USER'),
    password: process.env.POSTGRES_PASSWORD ?? '',
  },

  ollama: {
    baseUrl: getRequiredEnv('OLLAMA_BASE_URL'),
    chatModel: getRequiredEnv('OLLAMA_CHAT_MODEL'),
    embeddingModel: getRequiredEnv('OLLAMA_EMBEDDING_MODEL'),
  },

  rag: {
    topK: getNumberEnv('RAG_TOP_K', 3),
    similarityThreshold: getNumberEnv('RAG_SIMILARITY_THRESHOLD', 0.4),
  },
} as const;
