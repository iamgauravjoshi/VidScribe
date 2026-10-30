import express from 'express';

import { errorMiddleware } from './middleware/error.middleware.js';
import { getHealth } from './controllers/health.controller.js';
import { sourceRoutes } from './routes/source.routes.js';
import { aiSettingsRoutes } from './routes/ai-settings.routes.js';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', getHealth);
  app.use('/api/settings/ai', aiSettingsRoutes);
  app.use('/api/sources', sourceRoutes);
  app.use(errorMiddleware);

  return app;
}
