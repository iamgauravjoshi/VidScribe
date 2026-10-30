import type { LlmProviderId, ProviderGenerationResult } from '../../../types/llm.type.js';
import {
  compactTokenUsage,
  invalidProviderResponse,
  postProviderJson,
  readRecord,
  readTokenCount,
} from './provider-http.js';

export async function generateWithOpenAi(input: {
  modelId: string;
  prompt: string;
  apiKey: string;
  timeoutMs: number;
}): Promise<ProviderGenerationResult> {
  const result = await postProviderJson({
    provider: 'openai',
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/responses',
    headers: { Authorization: `Bearer ${input.apiKey}` },
    body: { model: input.modelId, input: input.prompt, max_output_tokens: 300 },
    timeoutMs: input.timeoutMs,
  });

  const response = readRecord(result);
  const output = response?.output;
  const text = Array.isArray(output)
    ? output
        .flatMap((item) => {
          const content = readRecord(item)?.content;
          return Array.isArray(content) ? content : [];
        })
        .map((item) => {
          const block = readRecord(item);
          return block?.type === 'output_text' && typeof block.text === 'string' ? block.text : '';
        })
        .join('')
        .trim()
    : '';

  if (!text) throw invalidProviderResponse('openai', 'OpenAI');

  const responseUsage = readRecord(response?.usage);
  const inputDetails = readRecord(responseUsage?.input_tokens_details);
  const outputDetails = readRecord(responseUsage?.output_tokens_details);
  const usage = responseUsage
    ? compactTokenUsage({
        inputTokens: readTokenCount(responseUsage.input_tokens),
        outputTokens: readTokenCount(responseUsage.output_tokens),
        totalTokens: readTokenCount(responseUsage.total_tokens),
        cachedInputTokens: readTokenCount(inputDetails?.cached_tokens),
        reasoningTokens: readTokenCount(outputDetails?.reasoning_tokens),
      })
    : undefined;

  return { text, ...(usage ? { usage } : {}) };
}
