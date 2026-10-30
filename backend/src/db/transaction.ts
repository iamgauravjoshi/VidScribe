import type { PoolClient } from 'pg';
import { pool } from './postgres.js';
import { logger } from '../shared/logger/index.js';

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await callback(client);

    await client.query('COMMIT');

    return result;
  } catch (error: unknown) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError: unknown) {
      logger.error('Database transaction rollback failed', {
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    }

    throw error;
  } finally {
    client.release();
  }
}
