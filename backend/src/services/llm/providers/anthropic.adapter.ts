import type { ProviderGenerationResult } from '../../../types/llm.type.js';
import {
  compactTokenUsage,
  invalidProviderResponse,
  postProviderJson,
  readRecord,
  readTokenCount,
} from './provider-http.js';

export async function generateWithAnthropic(input: {
  modelId: string;
  prompt: string;
  apiKey: string;
  timeoutMs: number;
}): Promise<ProviderGenerationResult> {
  const result = await postProviderJson({
    provider: 'anthropic',
    label: 'Claude',
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: input.modelId,
      max_tokens: 300,
      messages: [{ role: 'user', content: input.prompt }],
    },
    timeoutMs: input.timeoutMs,
  });

  const response = readRecord(result);
  const content = response?.content;
  const text = Array.isArray(content)
    ? content
        .map((block) => readRecord(block))
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block?.text as string)
        .join('')
        .trim()
    : '';

  if (!text) throw invalidProviderResponse('anthropic', 'Claude');

  const responseUsage = readRecord(response?.usage);
  const inputTokens = readTokenCount(responseUsage?.input_tokens);
  const cacheReadInputTokens = readTokenCount(responseUsage?.cache_read_input_tokens);
  const cacheCreationInputTokens = readTokenCount(responseUsage?.cache_creation_input_tokens);
  const outputTokens = readTokenCount(responseUsage?.output_tokens);
  const normalizedInputTokens = [inputTokens, cacheReadInputTokens, cacheCreationInputTokens]
    .reduce<number | undefined>((sum, value) =>
      sum === undefined && value === undefined ? undefined : (sum ?? 0) + (value ?? 0), undefined);
  const usage = responseUsage
    ? compactTokenUsage({
        inputTokens: normalizedInputTokens,
        outputTokens,
        totalTokens:
          normalizedInputTokens !== undefined && outputTokens !== undefined
            ? normalizedInputTokens + outputTokens
            : undefined,
        cachedInputTokens: cacheReadInputTokens,
        cacheCreationInputTokens,
      })
    : undefined;

  return { text, ...(usage ? { usage } : {}) };
}
