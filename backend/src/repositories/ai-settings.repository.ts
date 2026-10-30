import { pool } from '../db/postgres.js';
import { withTransaction } from '../db/transaction.js';
import type { LlmProviderId } from '../types/llm.type.js';

export interface StoredProviderConfig {
  providerId: LlmProviderId;
  modelId: string;
  apiKeyCiphertext: string | null;
}

export async function getActiveProvider(): Promise<LlmProviderId> {
  const result = await pool.query<{ active_provider: LlmProviderId }>(
    'SELECT active_provider FROM ai_runtime_settings WHERE id = 1',
  );

  return result.rows[0]?.active_provider ?? 'gemini';
}

export async function getStoredProviderConfig(
  providerId: LlmProviderId,
): Promise<StoredProviderConfig | null> {
  const result = await pool.query<{
    provider_id: LlmProviderId;
    model_id: string;
    api_key_ciphertext: string | null;
  }>(
    `SELECT provider_id, model_id, api_key_ciphertext
     FROM ai_provider_configs
     WHERE provider_id = $1`,
    [providerId],
  );

  const row = result.rows[0];
  return row
    ? { providerId: row.provider_id, modelId: row.model_id, apiKeyCiphertext: row.api_key_ciphertext }
    : null;
}

export async function listStoredProviderConfigs(): Promise<StoredProviderConfig[]> {
  const result = await pool.query<{
    provider_id: LlmProviderId;
    model_id: string;
    api_key_ciphertext: string | null;
  }>(
    `SELECT provider_id, model_id, api_key_ciphertext
     FROM ai_provider_configs
     ORDER BY provider_id`,
  );

  return result.rows.map((row) => ({
    providerId: row.provider_id,
    modelId: row.model_id,
    apiKeyCiphertext: row.api_key_ciphertext,
  }));
}

export async function saveProviderConfig(input: {
  providerId: LlmProviderId;
  modelId: string;
  apiKeyCiphertext: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO ai_provider_configs (provider_id, model_id, api_key_ciphertext)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider_id) DO UPDATE
     SET model_id = EXCLUDED.model_id,
         api_key_ciphertext = COALESCE(EXCLUDED.api_key_ciphertext, ai_provider_configs.api_key_ciphertext),
         updated_at = NOW()`,
    [input.providerId, input.modelId, input.apiKeyCiphertext],
  );
}

export async function setActiveProvider(providerId: LlmProviderId): Promise<void> {
  await pool.query(
    `INSERT INTO ai_runtime_settings (id, active_provider, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE
     SET active_provider = EXCLUDED.active_provider,
         updated_at = NOW()`,
    [providerId],
  );
}

export async function saveAndActivateProviderConfig(input: {
  providerId: LlmProviderId;
  modelId: string;
  apiKeyCiphertext: string | null;
}): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO ai_provider_configs (provider_id, model_id, api_key_ciphertext)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider_id) DO UPDATE
       SET model_id = EXCLUDED.model_id,
           api_key_ciphertext = COALESCE(EXCLUDED.api_key_ciphertext, ai_provider_configs.api_key_ciphertext),
           updated_at = NOW()`,
      [input.providerId, input.modelId, input.apiKeyCiphertext],
    );

    await client.query(
      `INSERT INTO ai_runtime_settings (id, active_provider, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE
       SET active_provider = EXCLUDED.active_provider,
           updated_at = NOW()`,
      [input.providerId],
    );
  });
}
