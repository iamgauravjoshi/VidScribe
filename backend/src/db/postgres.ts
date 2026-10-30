import pg from 'pg';
import { config } from '../shared/config/index.js';

const { Pool } = pg;

// IDs use BIGSERIAL in PostgreSQL and are represented as numbers throughout
// the current API. pg returns int8 as strings by default; convert only values
// that JavaScript can represent exactly rather than silently rounding them.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error('PostgreSQL BIGINT value exceeds JavaScript safe integer range.');
  }

  return parsed;
});

const testDatabaseUrl = process.env.VIDSCRIBE_TEST_DATABASE_URL;

if (testDatabaseUrl && process.env.NODE_ENV !== 'test') {
  throw new Error('VIDSCRIBE_TEST_DATABASE_URL can only be used when NODE_ENV=test.');
}

export const pool = testDatabaseUrl
  ? new Pool({ connectionString: testDatabaseUrl })
  : new Pool({
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      password: config.postgres.password,
    });

// logger.info('PostgreSQL connection established');

// logger.error('PostgreSQL connection failed', {
//   error: error instanceof Error ? error.message : String(error),
// });
