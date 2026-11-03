import { test as base } from '@playwright/test';

import {
  createE2ePool,
  deleteE2eSource,
  seedE2eSource,
  type E2eSource,
  type E2eSourceScenario,
} from '../backend/test/e2e-database';

const pool = createE2ePool();

interface Fixtures {
  createSource: (scenario?: E2eSourceScenario) => Promise<E2eSource>;
}

export const test = base.extend<Fixtures>({
  createSource: async ({}, use) => {
    const createdSourceIds: number[] = [];
    await use(async (scenario = 'transcript-ready') => {
      const source = await seedE2eSource(pool, scenario);
      createdSourceIds.push(source.id);
      return source;
    });

    await Promise.all(createdSourceIds.map((sourceId) => deleteE2eSource(pool, sourceId)));
  },
});

test.beforeAll(async () => {
  const count = await pool.query<{ count: string }>('SELECT COUNT(*)::TEXT AS count FROM public.sources');
  if (count.rows[0]?.count !== '0') {
    throw new Error('The E2E test database was not reset before the browser suite started.');
  }
});

test.afterAll(async () => {
  await pool.end();
});

export { expect } from '@playwright/test';
export { pool as e2eDb };
