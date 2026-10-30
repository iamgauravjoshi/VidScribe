import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';

import { logger } from '../shared/logger/index.js';

export function getRequestOperation(req: Request): string {
  const routePath = req.route?.path;
  const operation = `${req.baseUrl}${routePath ? `/${routePath}` : ''}`.replace(/\/{2,}/g, '/');

  return operation || 'unmatched';
}

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    logger.info('HTTP request completed', {
      requestId,
      method: req.method,
      operation: getRequestOperation(req),
      sourceId: res.locals.sourceId,
      turnId: res.locals.turnId,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
    });
  });

  next();
};
