import { config } from '../../shared/config/index.js';
import type { LlmProviderId, ProviderGenerationResult } from '../../types/llm.type.js';
import { generateWithAnthropic } from './providers/anthropic.adapter.js';
import { generateWithGemini } from './providers/gemini.adapter.js';
import { generateWithOpenAi } from './providers/openai.adapter.js';
import { generateOllamaAnswer } from './ollama.service.js';

export interface LlmGenerationInput {
  modelId: string;
  prompt: string;
  apiKey?: string;
  timeoutMs: number;
}

export interface LlmProviderAdapter {
  id: LlmProviderId;
  label: string;
  defaultModelId: string;
  requiresApiKey: boolean;
  generate(input: LlmGenerationInput): Promise<ProviderGenerationResult>;
}

export const llmProviders: readonly LlmProviderAdapter[] = [
  {
    id: 'gemini',
    label: 'Gemini',
    defaultModelId: 'gemini-3.8-flash',
    requiresApiKey: true,
    generate: (input) => generateWithGemini({
      modelId: input.modelId,
      prompt: input.prompt,
      apiKey: input.apiKey ?? '',
      timeoutMs: input.timeoutMs,
    }),
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultModelId: 'gpt-6-luna',
    requiresApiKey: true,
    generate: (input) => generateWithOpenAi({
      modelId: input.modelId,
      prompt: input.prompt,
      apiKey: input.apiKey ?? '',
      timeoutMs: input.timeoutMs,
    }),
  },
  {
    id: 'anthropic',
    label: 'Claude',
    defaultModelId: 'claude-sonnet-5-5',
    requiresApiKey: true,
    generate: (input) => generateWithAnthropic({
      modelId: input.modelId,
      prompt: input.prompt,
      apiKey: input.apiKey ?? '',
      timeoutMs: input.timeoutMs,
    }),
  },
  {
    id: 'ollama',
    label: 'Ollama',
    defaultModelId: config.ollama.chatModel,
    requiresApiKey: false,
    generate: (input) => generateOllamaAnswer({ prompt: input.prompt, modelId: input.modelId }),
  },
];

const providersById = new Map(llmProviders.map((provider) => [provider.id, provider]));

export function getLlmProvider(providerId: LlmProviderId): LlmProviderAdapter {
  const provider = providersById.get(providerId);
  if (!provider) throw new Error(`No LLM adapter is registered for ${providerId}.`);
  return provider;
}

export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return typeof value === 'string' && providersById.has(value as LlmProviderId);
}
