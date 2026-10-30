import { config } from '../../../shared/config/index.js';
import { chat } from '../../../shared/ollama/ollama.client.js';

export async function generateWithOllama(input: { modelId: string; prompt: string }): Promise<string> {
  const response = await chat({
    model: input.modelId,
    messages: [{ role: 'user', content: input.prompt }],
    stream: false,
    options: { num_predict: 300 },
  });

  const text = response.message.content.trim();
  if (!text) {
    throw new Error(`Ollama model ${input.modelId} returned an empty answer.`);
  }

  return text;
}
