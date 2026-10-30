import type { Request } from 'express';

export function validateCreateSourceRequest(req: Request): Record<string, string> {
  const errors: Record<string, string> = {};

  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return { body: 'Request body must be a JSON object.' };
  }

  const { url } = req.body;

  if (typeof url !== 'string') {
    return { url: 'A YouTube URL is required.' };
  }

  const trimmedUrl = url.trim();

  if (trimmedUrl.length === 0) {
    errors.url = 'A YouTube URL is required.';
  } else if (trimmedUrl.length > 2048) {
    errors.url = 'URL cannot exceed 2048 characters.';
  } else {
    try {
      new URL(trimmedUrl);
    } catch {
      errors.url = 'Enter a valid URL.';
    }
  }

  return errors;
}

export function validateSourceIdParam(req: Request): Record<string, string> {
  const errors: Record<string, string> = {};
  const sourceId = req.params.sourceId;

  if (typeof sourceId !== 'string' || !/^\d+$/.test(sourceId)) {
    errors.sourceId = 'Source ID must be a positive integer.';
    return errors;
  }

  const parsed = Number(sourceId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    errors.sourceId = 'Source ID must be a positive integer.';
  }

  return errors;
}
