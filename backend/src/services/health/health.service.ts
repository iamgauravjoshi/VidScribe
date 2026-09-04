import { pool } from '../../db/postgres.js';
import { config } from '../../shared/config/index.js';

export type ServiceHealthStatus = 'ok' | 'error';

export interface HealthCheckResult {
  status: ServiceHealthStatus;
  responseTimeMs?: number;
  error?: string;
}

export interface ApplicationHealth {
  status: 'ok' | 'degraded';
  services: {
    database: HealthCheckResult;
    ollama: HealthCheckResult;
  };
}

async function checkDatabase(): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    await pool.query('SELECT 1');

    return {
      status: 'ok',
      responseTimeMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'error',
      responseTimeMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkOllama(): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const response = await fetch(`${config.ollama.baseUrl}/api/tags`);

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}`);
    }

    return {
      status: 'ok',
      responseTimeMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'error',
      responseTimeMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getApplicationHealth(): Promise<ApplicationHealth> {
  const [database, ollama] = await Promise.all([checkDatabase(), checkOllama()]);

  const isHealthy = database.status === 'ok' && ollama.status === 'ok';

  return {
    status: isHealthy ? 'ok' : 'degraded',

    services: {
      database,
      ollama,
    },
  };
}
