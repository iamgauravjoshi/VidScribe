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

interface YouTubeTranscriptResponse {
  text: string;
  offset: number;
  duration: number;
  lang?: string;
}

export function normalizeTranscript(transcript: YouTubeTranscriptResponse[]): TranscriptSegment[] {
  return transcript.map((item) => ({
    text: item.text,
    start: item.offset,
    duration: item.duration,
    lang: item.lang,
  }));
}

export async function getTranscript(url: string) {
  const videoId = extractYouTubeVideoId(url);
  const rawTranscript = await fetchTranscript(videoId, { lang: 'en' });
  const transcript = normalizeTranscript(rawTranscript);

  return {
    videoId,
    transcript,
  };
}
