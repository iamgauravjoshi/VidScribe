/*
Implementing YouTube transcript extraction

youtube-url.service.ts
    └── URL parsing

youtube.service.ts
    └── transcript retrieval

video ID
   ↓
fetch transcript
   ↓
normalize transcript
*/

import { fetchTranscript } from 'youtube-transcript';
import { extractYouTubeVideoId } from './youtube-url.service.js';
import type { TranscriptSegment } from '../../types/transcript.type.js';
import { AppError, ErrorCode } from '../../shared/errors/index.js';
import { logger } from '../../shared/logger/index.js';

interface YouTubeTranscriptResponse {
  text: string;
  offset: number;
  duration: number;
  lang?: string;
}

export function normalizeTranscript(transcript: YouTubeTranscriptResponse[]): TranscriptSegment[] {
  return transcript
    .filter((item) =>
      typeof item.text === 'string'
      && item.text.trim().length > 0
      && Number.isFinite(item.offset)
      && item.offset >= 0
      && Number.isFinite(item.duration)
      && item.duration >= 0,
    )
    .map((item) => ({
      text: item.text.trim(),
      start: item.offset,
      duration: item.duration,
      lang: item.lang,
    }))
    .sort((left, right) => left.start - right.start);
}

export async function getTranscript(url: string) {
  const videoId = extractYouTubeVideoId(url);
  let rawTranscript: YouTubeTranscriptResponse[];

  try {
    rawTranscript = await fetchTranscript(videoId, { lang: 'en' });
  } catch (error: unknown) {
    logger.warn('YouTube transcript request failed', {
      videoId,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new AppError(
      'YouTube captions could not be retrieved. Check that the video is public, then retry.',
      ErrorCode.TRANSCRIPT_FETCH_FAILED,
      502,
    );
  }

  const transcript = normalizeTranscript(rawTranscript);

  if (transcript.length === 0 || transcript.every((segment) => !segment.text.trim())) {
    throw new AppError(
      'No usable English captions were found for this video.',
      ErrorCode.TRANSCRIPT_NOT_AVAILABLE,
      422,
    );
  }

  return {
    videoId,
    transcript,
  };
}
