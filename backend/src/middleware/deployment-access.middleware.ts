import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

import { config } from '../shared/config/index.js';

function credentialsMatch(authorization: string | undefined): boolean {
  if (!authorization?.startsWith('Basic ')) return false;

  let supplied: string;
  try {
    supplied = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }

  const expected = `${config.access.username}:${config.access.password ?? ''}`;
  const suppliedDigest = createHash('sha256').update(supplied).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

export const requireDeploymentAccess: RequestHandler = (req, res, next) => {
  if (!config.access.password || credentialsMatch(req.header('authorization'))) {
    next();
    return;
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="VidScribe private workspace", charset="UTF-8"');
  res.status(401).type('text/plain').send('Sign in to open the VidScribe workspace.');
};
