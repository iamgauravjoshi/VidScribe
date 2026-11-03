import { createApp } from '../src/app.js';
import { pool } from '../src/db/postgres.js';
import { config } from '../src/shared/config/index.js';

const server = createApp().listen(config.server.port, '127.0.0.1');
let shuttingDown = false;

server.on('listening', () => {
  process.stdout.write(`VidScribe E2E API listening on 127.0.0.1:${config.server.port}\n`);
});

server.on('error', (error: Error) => {
  process.stderr.write(`VidScribe E2E API failed to start: ${error.message}\n`);
  process.exitCode = 1;
});

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown().catch((error: unknown) => {
      process.stderr.write(`VidScribe E2E API shutdown failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
  });
}
