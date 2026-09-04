import type { Request, Response } from 'express';

import { getApplicationHealth } from '../services/health/health.service.js';

export async function getHealth(_req: Request, res: Response): Promise<void> {
  const health = await getApplicationHealth();

  const httpStatus = health.status === 'ok' ? 200 : 503;

  res.status(httpStatus).json({
    status: health.status,
    services: health.services,
  });
}
