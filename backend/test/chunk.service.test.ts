import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createChunks } from '../src/services/ingestion/chunk.service.js';

test('createChunks preserves timestamp bounds and segment-aware overlap', () => {
  const chunks = createChunks(
    [
      { text: 'alpha', start: 0, duration: 1 },
      { text: 'beta', start: 1, duration: 1 },
      { text: 'gamma', start: 2, duration: 1 },
      { text: 'delta', start: 3, duration: 1 },
    ],
    11,
    5,
  );

  assert.deepEqual(
    chunks.map(({ content, startTime, endTime }) => ({ content, startTime, endTime })),
    [
      { content: 'alpha beta', startTime: 0, endTime: 2 },
      { content: 'beta gamma', startTime: 1, endTime: 3 },
      { content: 'gamma delta', startTime: 2, endTime: 4 },
    ],
  );
});

test('createChunks rejects invalid chunk size and overlap configuration', () => {
  assert.throws(() => createChunks([], 0, 0), /greater than zero/);
  assert.throws(() => createChunks([], 10, -1), /smaller than chunk size/);
  assert.throws(() => createChunks([], 10, 10), /smaller than chunk size/);
});

test('createChunks returns no rows for a transcript with no usable segments', () => {
  assert.deepEqual(createChunks([{ text: '  ', start: 0, duration: 1 }], 100, 0), []);
});
