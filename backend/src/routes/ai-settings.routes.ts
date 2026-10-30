import { Router } from 'express';
import { readAiSettings, testAndSaveAiProviderSettings } from '../controllers/ai-settings.controller.js';
import { validate } from '../middleware/validation.middleware.js';
import { validateTestAndSaveAiProvider } from '../validators/ai-settings.validator.js';

export const aiSettingsRoutes = Router();

aiSettingsRoutes.get('/', readAiSettings);
aiSettingsRoutes.post('/test-and-save', validate(validateTestAndSaveAiProvider), testAndSaveAiProviderSettings);
