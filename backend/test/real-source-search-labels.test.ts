import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeEvidenceText,
  selectEvidenceAnchor,
} from '../scripts/real-source-search.labels.js';

test('selects a human-labeled phrase across case and caption line breaks', () => {
  const selected = selectEvidenceAnchor(
    [{ segmentIndex: 2, startSeconds: 12, text: 'The A is authenticity,\njust being yourself.' }],
    'THE A IS AUTHENTICITY',
  );

  assert.equal(selected.segment.segmentIndex, 2);
  assert.equal(selected.segment.startSeconds, 12);
  assert.equal(selected.matchingSegmentCount, 1);
  assert.equal(
    normalizeEvidenceText('The A is authenticity,\njust being yourself.'),
    'the a is authenticity, just being yourself.',
  );
});

test('uses an explicit occurrence when the labeled phrase appears in multiple segments', () => {
  const selected = selectEvidenceAnchor(
    [
      { segmentIndex: 1, startSeconds: 8, text: 'First reward-based learning process.' },
      { segmentIndex: 9, startSeconds: 68, text: 'This reward-based learning process repeats.' },
    ],
    'reward-based learning process',
    1,
  );

  assert.equal(selected.segment.segmentIndex, 9);
  assert.equal(selected.matchingSegmentCount, 2);
  assert.equal(selected.occurrence, 1);
});

test('rejects a missing label and invalid occurrence instead of silently choosing another segment', () => {
  const segments = [{ segmentIndex: 0, startSeconds: 0, text: 'A supporting caption.' }];

  assert.throws(() => selectEvidenceAnchor(segments, 'not present'), /was not found/);
  assert.throws(() => selectEvidenceAnchor(segments, 'supporting caption', 1), /was not found/);
  assert.throws(
    () => selectEvidenceAnchor(segments, 'supporting caption', -1),
    /non-negative integer/,
  );
});
