import { pool } from '../../db/postgres.js';
import { getActiveGenerationSettings } from '../llm/llm.service.js';
import type { LlmProviderId } from '../../types/llm.type.js';

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
    generation: {
      status: 'configured' | 'not_configured' | 'error';
      providerId: LlmProviderId;
      modelId: string;
    };
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

export async function getApplicationHealth(): Promise<ApplicationHealth> {
  const [database, generationSettings] = await Promise.all([
    checkDatabase(),
    getActiveGenerationSettings().catch(() => null),
  ]);

  const generation = generationSettings
    ? {
        status: generationSettings.configured ? 'configured' as const : 'not_configured' as const,
        providerId: generationSettings.provider,
        modelId: generationSettings.modelId,
      }
    : { status: 'error' as const, providerId: 'gemini' as const, modelId: 'unknown' };

  const isHealthy = database.status === 'ok' && generation.status === 'configured';

  return {
    status: isHealthy ? 'ok' : 'degraded',

    services: {
      database,
      generation,
    },
  };
}
