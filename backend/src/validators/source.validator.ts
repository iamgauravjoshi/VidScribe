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

export function validateTranscriptQuery(req: Request): Record<string, string> {
  const errors: Record<string, string> = {};
  const { cursor, limit, query, around } = req.query;

  if (cursor !== undefined) {
    if (typeof cursor !== 'string' || !/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) {
      errors.cursor = 'Transcript cursor must be a non-negative integer.';
    }
  }

  if (limit !== undefined) {
    if (typeof limit !== 'string' || !/^\d+$/.test(limit)) {
      errors.limit = 'Transcript page size must be an integer.';
    } else {
      const parsed = Number(limit);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 200) {
        errors.limit = 'Transcript page size must be between 1 and 200.';
      }
    }
  }

  if (query !== undefined) {
    if (typeof query !== 'string') {
      errors.query = 'Transcript search query must be a string.';
    } else if (query.trim().length > 200) {
      errors.query = 'Transcript search query cannot exceed 200 characters.';
    }
  }

  if (around !== undefined) {
    if (typeof around !== 'string' || !/^(?:\d+\.?\d*|\.\d+)$/.test(around) || !Number.isFinite(Number(around))) {
      errors.around = 'Transcript timestamp must be a non-negative number.';
    }
  }

  if (cursor !== undefined && around !== undefined) {
    errors.cursor = 'A transcript cursor cannot be combined with a timestamp lookup.';
  }
  if (query !== undefined && around !== undefined) {
    errors.query = 'Transcript search cannot be combined with a timestamp lookup.';
  }

  return errors;
}

export function validateTranscriptExportQuery(req: Request): Record<string, string> {
  const format = req.query.format;
  if (format === 'txt' || format === 'srt' || format === 'vtt') return {};
  return { format: 'Transcript export format must be txt, srt, or vtt.' };
}
