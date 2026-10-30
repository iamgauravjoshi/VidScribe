import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractYouTubeVideoId } from '../src/services/youtube/youtube-url.service.js';
import { AppError, ErrorCode } from '../src/shared/errors/index.js';

test('extractYouTubeVideoId accepts supported YouTube URL forms', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=abcdefghijk'), 'abcdefghijk');
  assert.equal(extractYouTubeVideoId('https://youtu.be/abcdefghijk?t=90'), 'abcdefghijk');
  assert.equal(extractYouTubeVideoId('https://youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
});

test('extractYouTubeVideoId rejects other hosts and malformed IDs', () => {
  for (const input of [
    'https://example.com/watch?v=abcdefghijk',
    'https://www.youtube.com/watch?v=short',
    'not a URL',
  ]) {
    assert.throws(
      () => extractYouTubeVideoId(input),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.INVALID_YOUTUBE_URL,
    );
  }
});
