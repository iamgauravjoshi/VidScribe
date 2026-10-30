/*
ollama.service.ts
       │
       │ generateAnswer()
       ▼
ollama.client.ts
       │
       ├── timeout
       ├── AbortController
       ├── HTTP status
       ├── response validation
       ├── network error
       │
       ▼
http://localhost:11434
*/

import { chat } from '../../shared/ollama/ollama.client.js';
import type { ProviderGenerationResult } from '../../types/llm.type.js';
import { compactTokenUsage, readRecord, readTokenCount } from './providers/provider-http.js';

export async function generateOllamaAnswer(input: { prompt: string; modelId: string }): Promise<ProviderGenerationResult> {
  const response = await chat({
    model: input.modelId,
    messages: [{ role: 'user', content: input.prompt }],
    stream: false,
    options: { num_predict: 300 },
  });

  const text = response.message.content.trim();
  if (!text) throw new Error(`Ollama model ${input.modelId} returned an empty answer.`);

  // The upstream HTTP response includes these metrics, but the installed
  // ollama client version does not include them in its TypeScript interface.
  const usageResponse = readRecord(response);
  const inputTokens = readTokenCount(usageResponse?.prompt_eval_count);
  const outputTokens = readTokenCount(usageResponse?.eval_count);
  const usage = compactTokenUsage({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined,
  });

  return {
    text,
    ...(usage ? { usage } : {}),
  };
}
