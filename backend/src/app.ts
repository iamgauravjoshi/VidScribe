import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { errorMiddleware } from './middleware/error.middleware.js';
import { requireDeploymentAccess } from './middleware/deployment-access.middleware.js';
import { getHealth } from './controllers/health.controller.js';
import { sourceRoutes } from './routes/source.routes.js';
import { aiSettingsRoutes } from './routes/ai-settings.routes.js';
import { requestContextMiddleware } from './middleware/request-context.middleware.js';
import { config } from './shared/config/index.js';

export function createApp() {
  const app = express();

  app.use(requestContextMiddleware);
  app.use(express.json({ limit: '32kb' }));

  // Keep a lightweight public liveness route for Render. Full health details
  // remain behind the workspace access gate because they expose app state.
  app.get('/api/health/live', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.use('/api', requireDeploymentAccess);
  app.get('/api/health', getHealth);
  app.use('/api/settings/ai', aiSettingsRoutes);
  app.use('/api/sources', sourceRoutes);

  if (config.nodeEnv === 'production') {
    const frontendDirectory = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
    app.use(express.static(frontendDirectory, { index: false, maxAge: '1h' }));

    app.use((req, res, next) => {
      const isWorkspacePage =
        req.method === 'GET' &&
        (req.path === '/library' ||
          req.path.startsWith('/library/') ||
          req.path === '/settings' ||
          req.path.startsWith('/settings/') ||
          req.path === '/sources' ||
          req.path.startsWith('/sources/'));

      if (isWorkspacePage) {
        requireDeploymentAccess(req, res, next);
        return;
      }

      next();
    });

    app.get('/{*path}', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }

      res.sendFile(path.join(frontendDirectory, 'index.html'), (error) => {
        if (error) next(error);
      });
    });
  }

  app.use(errorMiddleware);

  return app;
}
