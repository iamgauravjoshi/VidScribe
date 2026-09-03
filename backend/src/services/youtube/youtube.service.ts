// Implementing YouTube transcript extraction

import { fetchTranscript } from 'youtube-transcript';
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

export function extractVideoId(url: string): string {
  const parsedUrl = new URL(url);

  if (parsedUrl.hostname === 'youtu.be') {
    return parsedUrl.pathname.substring(1);
  }

  if (parsedUrl.hostname === 'www.youtube.com' || parsedUrl.hostname === 'youtube.com') {
    const videoId = parsedUrl.searchParams.get('v');

    if (!videoId) {
      throw new Error('Invalid YouTube URL');
    }

    return videoId;
  }

  throw new Error('URL is not a YouTube URL');
}

export async function getTranscript(url: string) {
  const videoId = extractVideoId(url);
  const rawTranscript = await fetchTranscript(videoId, { lang: 'en' });
  const transcript = normalizeTranscript(rawTranscript);

  return {
    videoId,
    transcript,
  };
}
