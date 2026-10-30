import type { Request } from 'express';
import { LLM_PROVIDER_IDS } from '../types/llm.type.js';

const providerIds = new Set<string>(LLM_PROVIDER_IDS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

export function validateProviderIdParam(req: Request): Record<string, string> {
  const providerId = req.params.providerId;
  return typeof providerId === 'string' && providerIds.has(providerId)
    ? {}
    : { providerId: 'Provider must be one of the supported providers.' };
}

export function validateSaveAiProvider(req: Request): Record<string, string> {
  const errors = validateProviderIdParam(req);
  if (!isPlainObject(req.body)) return { ...errors, body: 'Request body must be a JSON object.' };

  return { ...errors, ...validateProviderConfigFields(req.body) };
}

export function validateTestAndSaveAiProvider(req: Request): Record<string, string> {
  if (!isPlainObject(req.body)) return { body: 'Request body must be a JSON object.' };
  const errors: Record<string, string> = {};
  if (typeof req.body.providerId !== 'string' || !providerIds.has(req.body.providerId)) {
    errors.providerId = 'Provider must be one of the supported providers.';
  }
  const fieldErrors = validateProviderConfigFields(req.body);
  if (req.body.providerId === 'ollama' && typeof req.body.apiKey === 'string' && req.body.apiKey.trim()) {
    fieldErrors.apiKey = 'Ollama does not use an API key.';
  }
  return { ...errors, ...fieldErrors };
}

function validateProviderConfigFields(body: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};

  const { modelId, apiKey } = body;
  if (typeof modelId !== 'string' || modelId.trim().length === 0) {
    errors.modelId = 'Model ID is required.';
  } else if (modelId.trim().length > 150 || hasControlCharacters(modelId)) {
    errors.modelId = 'Model ID must be 150 characters or fewer and contain no control characters.';
  }

  if (apiKey !== undefined && typeof apiKey !== 'string') {
    errors.apiKey = 'API key must be text.';
  } else if (typeof apiKey === 'string' && (apiKey.trim().length > 512 || hasControlCharacters(apiKey))) {
    errors.apiKey = 'API key must be 512 characters or fewer and contain no control characters.';
  }

  return errors;
}

export function validateActiveProvider(req: Request): Record<string, string> {
  if (!isPlainObject(req.body)) return { body: 'Request body must be a JSON object.' };
  return typeof req.body.providerId === 'string' && providerIds.has(req.body.providerId)
    ? {}
    : { providerId: 'Provider must be one of the supported providers.' };
}
