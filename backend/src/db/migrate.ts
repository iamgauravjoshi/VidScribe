import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pool } from './postgres.js';
import { logger } from '../shared/logger/index.js';

const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const migrationLockKey = 7_224_619_801;

interface MigrationFile {
  version: string;
  path: string;
}

function isMigrationFile(name: string): boolean {
  return /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name);
}

async function listMigrations(): Promise<MigrationFile[]> {
  const names = await readdir(migrationsDirectory);

  return names
    .filter(isMigrationFile)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      version: name.replace(/\.sql$/i, ''),
      path: fileURLToPath(new URL(`../../migrations/${name}`, import.meta.url)),
    }));
}

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query('SELECT pg_advisory_lock($1)', [migrationLockKey]);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const migration of await listMigrations()) {
      const sql = await readFile(migration.path, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE version = $1',
        [migration.version],
      );

      if (applied.rows[0]) {
        if (applied.rows[0].checksum !== checksum) {
          throw new Error(
            `Migration ${migration.version} has changed after being applied. Add a new migration instead.`,
          );
        }

        continue;
      }

      await client.query('BEGIN');

      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [migration.version, checksum],
        );
        await client.query('COMMIT');
        logger.info('Database migration applied', { version: migration.version });
      } catch (error: unknown) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError: unknown) {
          logger.error('Database migration rollback failed', {
            version: migration.version,
            rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          });
        }

        throw error;
      }
    }
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [migrationLockKey]);
      } catch (error: unknown) {
        logger.error('Could not release database migration lock', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    client.release();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (invokedPath === import.meta.url) {
  try {
    await runMigrations();
  } catch (error: unknown) {
    logger.error('Database migrations failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
