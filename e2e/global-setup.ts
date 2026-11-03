import {
  assertDedicatedTestDatabase,
  createE2ePool,
  resetE2eSources,
} from '../backend/test/e2e-database';

export default async function globalSetup(): Promise<void> {
  assertDedicatedTestDatabase(process.env.VIDSCRIBE_TEST_DATABASE_URL);
  const pool = createE2ePool();
  try {
    await pool.query('SELECT 1');
    await resetE2eSources(pool);
    process.stdout.write('Reset source fixtures in the isolated VidScribe test database.\n');
  } finally {
    await pool.end();
  }
}
