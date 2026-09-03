import type { Request } from 'express';

export function validateChatRequest(req: Request): Record<string, string> {
  const errors: Record<string, string> = {};

  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    errors.body = 'Request body must be a JSON object.';

    return errors;
  }

  const { question } = req.body;

  if (typeof question !== 'string') {
    errors.question = 'Question is required and must be a string.';

    return errors;
  }

  const trimmedQuestion = question.trim();

  if (trimmedQuestion.length === 0) {
    errors.question = 'Question cannot be empty.';
  }

  if (trimmedQuestion.length > 2000) {
    errors.question = 'Question cannot exceed 2000 characters.';
  }

  return errors;
}

export function validateVideoIdParam(req: Request): Record<string, string> {
  const errors: Record<string, string> = {};

  const { videoId } = req.params;

  if (!videoId) {
    errors.videoId = 'Video ID is required.';

    return errors;
  }

  const parsedVideoId = Number(videoId);

  if (!Number.isInteger(parsedVideoId) || parsedVideoId <= 0) {
    errors.videoId = 'Video ID must be a positive integer.';
  }

  return errors;
}
