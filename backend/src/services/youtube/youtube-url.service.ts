/*
youtube-url.service.ts
    └── URL parsing

youtube.service.ts
    └── transcript retrieval
 */

import { AppError, ErrorCode } from '../../shared/errors/index.js';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export function extractYouTubeVideoId(input: string): string {
  const value = input.trim();

  if (!value) {
    throw new AppError('YouTube URL is required.', ErrorCode.INVALID_YOUTUBE_URL, 400);
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new AppError('Invalid YouTube URL.', ErrorCode.INVALID_YOUTUBE_URL, 400);
  }

  const hostname = url.hostname.toLowerCase();

  /*
   * Reject arbitrary domains.
   */
  if (!YOUTUBE_HOSTS.has(hostname)) {
    throw new AppError('URL must be a valid YouTube URL.', ErrorCode.INVALID_YOUTUBE_URL, 400);
  }

  let videoId: string | null = null;

  /*
   * youtu.be/VIDEO_ID
   */
  if (hostname === 'youtu.be') {
    videoId = url.pathname.split('/')[1] ?? null;
  }

  /*
   * youtube.com/watch?v=VIDEO_ID
   */
  else if (url.pathname === '/watch') {
    videoId = url.searchParams.get('v');
  }

  /*
   * youtube.com/shorts/VIDEO_ID
   */
  else if (url.pathname.startsWith('/shorts/')) {
    videoId = url.pathname.split('/')[2] ?? null;
  }

  /*
   * youtube.com/embed/VIDEO_ID
   */
  else if (url.pathname.startsWith('/embed/')) {
    videoId = url.pathname.split('/')[2] ?? null;
  }

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    throw new AppError(
      'Could not extract a valid YouTube video ID.',
      ErrorCode.INVALID_YOUTUBE_URL,
      400,
    );
  }

  return videoId;
}

export function buildCanonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
