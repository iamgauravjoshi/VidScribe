import type { Request } from 'express';

export function validateProcessVideoRequest(req: Request): Record<string, string> {
  const errors: Record<string, string> = {};

  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    errors.body = 'Request body must be a JSON object.';

    return errors;
  }

  const { url } = req.body;

  if (typeof url !== 'string') {
    errors.url = 'URL is required and must be a string.';

    return errors;
  }

  const trimmedUrl = url.trim();

  if (trimmedUrl.length === 0) {
    errors.url = 'URL cannot be empty.';

    return errors;
  }

  if (trimmedUrl.length > 2048) {
    errors.url = 'URL cannot exceed 2048 characters.';
  }

  try {
    const parsedUrl = new URL(trimmedUrl);

    const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');

    const isYouTubeHost =
      hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'youtu.be';

    if (!isYouTubeHost) {
      errors.url = 'URL must be a valid YouTube URL.';
    }
  } catch {
    errors.url = 'URL must be a valid URL.';
  }

  return errors;
}
