import { ErrorCode, AppError } from '../../../shared/errors/index.js';
import type { LlmProviderId, ProviderGenerationResult } from '../../../types/llm.type.js';
import {
  compactTokenUsage,
  invalidProviderResponse,
  postProviderJson,
  readRecord,
  readTokenCount,
} from './provider-http.js';

export async function generateWithGemini(input: {
  modelId: string;
  prompt: string;
  apiKey: string;
  timeoutMs: number;
}): Promise<ProviderGenerationResult> {
  const result = await postProviderJson({
    provider: 'gemini',
    label: 'Gemini',
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.modelId)}:generateContent`,
    headers: { 'x-goog-api-key': input.apiKey },
    body: {
      contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
      generationConfig: { maxOutputTokens: 300 },
    },
    timeoutMs: input.timeoutMs,
  });

  const response = readRecord(result);
  const candidates = response?.candidates;
  const firstCandidate = Array.isArray(candidates) ? readRecord(candidates[0]) : null;
  const content = readRecord(firstCandidate?.content);
  const parts = content?.parts;
  const text = Array.isArray(parts)
    ? parts
        .map((part) => readRecord(part)?.text)
        .filter((part): part is string => typeof part === 'string')
        .join('')
        .trim()
    : '';

  if (!text) throw invalidProviderResponse('gemini', 'Gemini');

  const usageMetadata = readRecord(response?.usageMetadata);
  const usage = usageMetadata
    ? compactTokenUsage({
        inputTokens: readTokenCount(usageMetadata.promptTokenCount),
        outputTokens: readTokenCount(usageMetadata.candidatesTokenCount),
        totalTokens: readTokenCount(usageMetadata.totalTokenCount),
        cachedInputTokens: readTokenCount(usageMetadata.cachedContentTokenCount),
        reasoningTokens: readTokenCount(usageMetadata.thoughtsTokenCount),
      })
    : undefined;

  return { text, ...(usage ? { usage } : {}) };
}
