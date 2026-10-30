import {
  getActiveProvider,
  getStoredProviderConfig,
} from '../../repositories/ai-settings.repository.js';
import { config } from '../../shared/config/index.js';
import { AppError, ErrorCode } from '../../shared/errors/index.js';
import { logger } from '../../shared/logger/index.js';
import { getLocalSecretEncryptionKey } from '../../shared/secrets/local-key-store.js';
import { decryptSecret } from '../../shared/secrets/secret-cipher.js';
import type { GeneratedText, LlmProviderId } from '../../types/llm.type.js';
import { getLlmProvider } from './provider-registry.js';

export interface ActiveGenerationSettings {
  provider: LlmProviderId;
  modelId: string;
  configured: boolean;
  apiKeyCiphertext: string | null;
}

export async function getActiveGenerationSettings(): Promise<ActiveGenerationSettings> {
  const providerId = await getActiveProvider();
  const adapter = getLlmProvider(providerId);
  const stored = await getStoredProviderConfig(providerId);

  return {
    provider: providerId,
    modelId: stored?.modelId ?? adapter.defaultModelId,
    configured: !adapter.requiresApiKey || Boolean(stored?.apiKeyCiphertext),
    apiKeyCiphertext: stored?.apiKeyCiphertext ?? null,
  };
}

export async function generateAnswer(prompt: string): Promise<GeneratedText> {
  const settings = await getActiveGenerationSettings();
  const adapter = getLlmProvider(settings.provider);

  if (adapter.requiresApiKey && !settings.apiKeyCiphertext) {
    throw new AppError(
      `${adapter.label} is the selected answer provider but is not configured. Add its API key in AI settings or select a configured provider.`,
      ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
      409,
      { provider: settings.provider },
    );
  }

  let apiKey: string | undefined;
  if (settings.apiKeyCiphertext) {
    try {
      apiKey = decryptSecret(settings.apiKeyCiphertext, await getLocalSecretEncryptionKey());
    } catch {
      throw new AppError(
        'VidScribe could not unlock the saved provider key. Restore the local encryption key or enter the provider key again in AI settings.',
        ErrorCode.AI_PROVIDER_KEY_UNAVAILABLE,
        500,
        { provider: settings.provider },
      );
    }
  }

  const startedAt = Date.now();
  logger.info('AI answer generation started', {
    provider: settings.provider,
    modelId: settings.modelId,
    timeoutMs: config.ai.requestTimeoutMs,
  });

  let generated: Awaited<ReturnType<typeof adapter.generate>>;
  try {
    generated = await adapter.generate({
      modelId: settings.modelId,
      prompt,
      apiKey,
      timeoutMs: config.ai.requestTimeoutMs,
    });
  } catch (error: unknown) {
    logger.error('AI answer generation failed', {
      provider: settings.provider,
      modelId: settings.modelId,
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof AppError ? error.code : 'AI_PROVIDER_REQUEST_FAILED',
    });
    throw error;
  }

  logger.info('AI answer generation completed', {
    provider: settings.provider,
    modelId: settings.modelId,
    durationMs: Date.now() - startedAt,
    usage: generated.usage ?? null,
  });

  return {
    text: generated.text,
    provider: settings.provider,
    modelId: settings.modelId,
    ...(generated.usage ? { usage: generated.usage } : {}),
  };
}
