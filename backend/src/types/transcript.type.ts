export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
  lang?: string;
}

export type TranscriptStatus = 'NOT_AVAILABLE' | 'PROCESSING' | 'READY' | 'FAILED';

export interface TranscriptSegmentDto {
  segmentIndex: number;
  startSeconds: number;
  durationSeconds: number;
  text: string;
}

export interface TranscriptPageDto {
  status: TranscriptStatus;
  languageCode: string | null;
  retrievalMethod: 'youtube_captions' | null;
  segmentCount: number;
  fetchedAt: string | null;
  failure: { code: string; message: string; retryable: boolean } | null;
  segments: TranscriptSegmentDto[];
  nextCursor: number | null;
}
