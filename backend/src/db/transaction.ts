import type { PoolClient } from 'pg';
import { pool } from './postgres.js';

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await callback(client);

    await client.query('COMMIT');

    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');

    throw error;
  } finally {
    client.release();
  }
}
