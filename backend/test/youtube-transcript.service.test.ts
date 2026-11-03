import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeTranscript } from '../src/services/youtube/youtube.service.js';

test('normalizeTranscript converts srv3 millisecond timestamps and durations to seconds', () => {
  const transcript = normalizeTranscript([
    { text: 'Later', offset: 2500, duration: 1200, lang: 'en' },
    { text: 'Earlier', offset: 1000, duration: 900, lang: 'en' },
  ]);

  assert.deepEqual(transcript, [
    { text: 'Earlier', start: 1, duration: 0.9, lang: 'en' },
    { text: 'Later', start: 2.5, duration: 1.2, lang: 'en' },
  ]);
});

test('normalizeTranscript preserves classic second timestamps, including long-video offsets', () => {
  const transcript = normalizeTranscript([
    { text: 'Later', offset: 3672.5, duration: 1.2, lang: 'en' },
    { text: 'Earlier', offset: 1, duration: 0.9, lang: 'en' },
  ]);

  assert.deepEqual(transcript, [
    { text: 'Earlier', start: 1, duration: 0.9, lang: 'en' },
    { text: 'Later', start: 3672.5, duration: 1.2, lang: 'en' },
  ]);
});

test('normalizeTranscript ignores invalid rows when inferring units', () => {
  const transcript = normalizeTranscript([
    { text: 'Valid', offset: 1000, duration: 1000, lang: 'en' },
    { text: '   ', offset: 2000, duration: 1000, lang: 'en' },
    { text: 'Invalid time', offset: Number.NaN, duration: 1000, lang: 'en' },
  ]);

  assert.deepEqual(transcript, [{ text: 'Valid', start: 1, duration: 1, lang: 'en' }]);
});
