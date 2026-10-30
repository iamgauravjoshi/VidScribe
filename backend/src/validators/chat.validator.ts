import type { Request } from 'express';

export function validateChatRequest(req: Request): Record<string, string> {
  const errors: Record<string, string> = {};

  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    errors.body = 'Request body must be a JSON object.';

    return errors;
  }

  const { question, requestId } = req.body;

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

  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    errors.requestId = 'Request ID must be a valid UUID.';
  }

  return errors;
}
