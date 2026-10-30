import type { Request, Response } from 'express';
import { getAiSettings, testAndSaveAiProvider } from '../services/ai-settings.service.js';
import type { LlmProviderId } from '../types/llm.type.js';

export async function readAiSettings(_req: Request, res: Response): Promise<void> {
  res.json({ settings: await getAiSettings() });
}

export async function testAndSaveAiProviderSettings(req: Request, res: Response): Promise<void> {
  const result = await testAndSaveAiProvider({
    providerId: req.body.providerId as LlmProviderId,
    modelId: (req.body.modelId as string).trim(),
    apiKey: typeof req.body.apiKey === 'string' ? req.body.apiKey : undefined,
  });

  res.json(result);
}
