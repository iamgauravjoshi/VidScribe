export const LLM_PROVIDER_IDS = ['gemini', 'openai', 'anthropic', 'ollama'] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export interface AiProviderConfigDto {
  id: LlmProviderId;
  label: string;
  modelId: string;
  requiresApiKey: boolean;
  configured: boolean;
  active: boolean;
}

export interface AiSettingsDto {
  activeProvider: LlmProviderId;
  providers: AiProviderConfigDto[];
}

export interface ProviderTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
}

export interface ProviderGenerationResult {
  text: string;
  usage?: ProviderTokenUsage;
}

export interface GeneratedText {
  text: string;
  provider: LlmProviderId;
  modelId: string;
  usage?: ProviderTokenUsage;
}
