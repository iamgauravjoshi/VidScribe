import { Router } from 'express';

import {
  askSourceQuestion,
  createSource,
  deleteSource,
  listSources,
  readSourceConversation,
  readSource,
  retrySourceProcessing,
} from '../controllers/source.controller.js';
import { validate } from '../middleware/validation.middleware.js';
import { validateChatRequest } from '../validators/chat.validator.js';
import { validateCreateSourceRequest, validateSourceIdParam } from '../validators/source.validator.js';

export const sourceRoutes = Router();

sourceRoutes.post('/', validate(validateCreateSourceRequest), createSource);
sourceRoutes.get('/', listSources);
sourceRoutes.get('/:sourceId', validate(validateSourceIdParam), readSource);
sourceRoutes.get('/:sourceId/conversation', validate(validateSourceIdParam), readSourceConversation);
sourceRoutes.post('/:sourceId/retry', validate(validateSourceIdParam), retrySourceProcessing);
sourceRoutes.delete('/:sourceId', validate(validateSourceIdParam), deleteSource);
sourceRoutes.post(
  '/:sourceId/chat',
  validate(validateSourceIdParam),
  validate(validateChatRequest),
  askSourceQuestion,
);
