import {
  getActiveProvider,
  getStoredProviderConfig,
  listStoredProviderConfigs,
  saveAndActivateProviderConfig,
  saveProviderConfig,
  setActiveProvider as persistActiveProvider,
} from '../repositories/ai-settings.repository.js';
import { AppError, ErrorCode } from '../shared/errors/index.js';
import { getLocalSecretEncryptionKey } from '../shared/secrets/local-key-store.js';
import { decryptSecret, encryptSecret } from '../shared/secrets/secret-cipher.js';
import { config } from '../shared/config/index.js';
import { logger } from '../shared/logger/index.js';
import type { AiSettingsDto, LlmProviderId, ProviderTokenUsage } from '../types/llm.type.js';
import { getLlmProvider, llmProviders } from './llm/provider-registry.js';

export async function getAiSettings(): Promise<AiSettingsDto> {
  const [activeProvider, storedProviders] = await Promise.all([
    getActiveProvider(),
    listStoredProviderConfigs(),
  ]);
  const storedByProvider = new Map(storedProviders.map((item) => [item.providerId, item]));

  return {
    activeProvider,
    providers: llmProviders.map((provider) => {
      const stored = storedByProvider.get(provider.id);
      return {
        id: provider.id,
        label: provider.label,
        modelId: stored?.modelId ?? provider.defaultModelId,
        requiresApiKey: provider.requiresApiKey,
        configured: !provider.requiresApiKey || Boolean(stored?.apiKeyCiphertext),
        active: provider.id === activeProvider,
      };
    }),
  };
}

export async function updateAiProvider(input: {
  providerId: LlmProviderId;
  modelId: string;
  apiKey?: string;
}): Promise<AiSettingsDto> {
  const provider = getLlmProvider(input.providerId);
  const current = await getStoredProviderConfig(input.providerId);
  const apiKey = input.apiKey?.trim();

  if (provider.requiresApiKey && !apiKey && !current?.apiKeyCiphertext) {
    throw new AppError(
      `Add a ${provider.label} API key before saving this provider.`,
      ErrorCode.AI_PROVIDER_KEY_REQUIRED,
      422,
      { provider: input.providerId },
    );
  }

  const apiKeyCiphertext = apiKey
    ? encryptSecret(apiKey, await getLocalSecretEncryptionKey())
    : null;

  await saveProviderConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKeyCiphertext,
  });

  return getAiSettings();
}

export async function chooseActiveProvider(providerId: LlmProviderId): Promise<AiSettingsDto> {
  const provider = getLlmProvider(providerId);
  const stored = await getStoredProviderConfig(providerId);

  if (provider.requiresApiKey && !stored?.apiKeyCiphertext) {
    throw new AppError(
      `Configure ${provider.label} with an API key before selecting it for answers.`,
      ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
      409,
      { provider: providerId },
    );
  }

  await persistActiveProvider(providerId);
  return getAiSettings();
}

export async function testAndSaveAiProvider(input: {
  providerId: LlmProviderId;
  modelId: string;
  apiKey?: string;
}): Promise<{ settings: AiSettingsDto; durationMs: number }> {
  const provider = getLlmProvider(input.providerId);
  const stored = await getStoredProviderConfig(input.providerId);
  const submittedKey = provider.requiresApiKey ? input.apiKey?.trim() : undefined;
  let apiKey = submittedKey;

  if (provider.requiresApiKey && !apiKey && stored?.apiKeyCiphertext) {
    try {
      apiKey = decryptSecret(stored.apiKeyCiphertext, await getLocalSecretEncryptionKey());
    } catch {
      throw new AppError(
        'VidScribe could not unlock the saved provider key. Enter it again in settings.',
        ErrorCode.AI_PROVIDER_KEY_UNAVAILABLE,
        500,
        { provider: input.providerId },
      );
    }
  }

  if (provider.requiresApiKey && !apiKey) {
    throw new AppError(
      `Add a ${provider.label} API key before testing this provider.`,
      ErrorCode.AI_PROVIDER_KEY_REQUIRED,
      422,
      { provider: input.providerId },
    );
  }

  const apiKeyCiphertext = submittedKey
    ? encryptSecret(submittedKey, await getLocalSecretEncryptionKey())
    : null;

  const startedAt = Date.now();
  let usage: ProviderTokenUsage | undefined;
  try {
    const result = await provider.generate({
      modelId: input.modelId,
      prompt: 'Reply with exactly: VidScribe connection test successful.',
      ...(apiKey ? { apiKey } : {}),
      timeoutMs: config.ai.requestTimeoutMs,
    });
    usage = result.usage;
  } catch (error: unknown) {
    logger.error('AI provider connection test failed', {
      provider: provider.id,
      modelId: input.modelId,
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof AppError ? error.code : 'AI_PROVIDER_REQUEST_FAILED',
    });
    throw error;
  }
  const durationMs = Date.now() - startedAt;

  logger.info('AI provider connection test completed', {
    provider: provider.id,
    modelId: input.modelId,
    durationMs,
    usage: usage ?? null,
  });

  await saveAndActivateProviderConfig({
    providerId: input.providerId,
    modelId: input.modelId,
    apiKeyCiphertext,
  });

  return { settings: await getAiSettings(), durationMs };
}
