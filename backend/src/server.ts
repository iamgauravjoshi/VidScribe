import { createApp } from './app.js';
import { pool } from './db/postgres.js';
import { config } from './shared/config/index.js';
import { logger } from './shared/logger/index.js';
import { startIngestionWorker } from './services/ingestion/worker.service.js';

const app = createApp();
if (config.nodeEnv === 'production' && (!config.access.password || config.access.password.length < 24)) {
  throw new Error('Set VIDSCRIBE_ACCESS_PASSWORD to a unique password of at least 24 characters before starting production.');
}

const server = app.listen(config.server.port, config.server.host, () => {
  logger.info('VidScribe API started', {
    port: config.server.port,
    host: config.server.host,
    environment: config.nodeEnv,
  });
});

const ingestionWorker = startIngestionWorker();
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info('Shutting down VidScribe', { signal });

  const closeHttpServer = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  try {
    await Promise.all([closeHttpServer, ingestionWorker.stop()]);
  } catch (error: unknown) {
    logger.error('Graceful shutdown encountered an error', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
