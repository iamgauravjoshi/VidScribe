import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RetrievedChunkRow } from '../src/types/chunk.type.js';
import { mapRetrievedChunk, mapRetrievedChunks } from '../src/services/rag/citation.service.js';

function retrievedChunk(overrides: Partial<RetrievedChunkRow> = {}): RetrievedChunkRow {
  return {
    id: 41,
    source_id: 7,
    chunk_index: 2,
    content: 'The full chunk gives the answer context around a supporting sentence.',
    start_seconds: 60,
    end_seconds: 120,
    external_id: 'video-123',
    canonical_url: 'https://www.youtube.com/watch?v=video-123',
    title: 'Citation test',
    relevanceScore: 0.42,
    phrase_match: false,
    full_query_match: true,
    citation_segment_index: 5,
    citation_start_seconds: 88.4,
    citation_end_seconds: 91.2,
    citation_excerpt: 'The sentence that directly supports the answer.',
    ...overrides,
  };
}

test('maps a retrieved transcript segment to a precise citation time and excerpt', () => {
  const citation = mapRetrievedChunk(retrievedChunk());
  const href = new URL(citation.href);

  assert.equal(citation.id, '41');
  assert.equal(citation.startSeconds, 88.4);
  assert.equal(citation.endSeconds, 91.2);
  assert.equal(citation.excerpt, 'The sentence that directly supports the answer.');
  assert.equal(href.searchParams.get('v'), 'video-123');
  assert.equal(href.searchParams.get('t'), '88s');
});

test('falls back to the chunk citation for legacy retrieval rows without a transcript segment', () => {
  const citation = mapRetrievedChunk(
    retrievedChunk({
      citation_segment_index: null,
      citation_start_seconds: null,
      citation_end_seconds: null,
      citation_excerpt: null,
    }),
  );
  const href = new URL(citation.href);

  assert.equal(citation.startSeconds, 60);
  assert.equal(citation.endSeconds, 120);
  assert.equal(citation.excerpt, 'The full chunk gives the answer context around a supporting sentence.');
  assert.equal(href.searchParams.get('t'), '60s');
});

test('deduplicates overlapping chunks that resolve to the same transcript segment', () => {
  const firstChunk = retrievedChunk({ id: 41 });
  const overlappingChunk = retrievedChunk({ id: 42, chunk_index: 3 });
  const nextSegment = retrievedChunk({ id: 43, citation_segment_index: 6 });

  const citations = mapRetrievedChunks([firstChunk, overlappingChunk, nextSegment]);

  assert.deepEqual(
    citations.map((citation) => citation.id),
    ['41', '43'],
    'the highest-ranked chunk represents a segment cited by overlapping chunks',
  );
});
