import {
  getTranscriptMetadata,
  listAllTranscriptSegments,
  listTranscriptSegments,
  type StoredTranscriptSegment,
} from '../../repositories/transcript.repository.js';
import { requestTranscriptRefresh } from '../../repositories/ingestion-job.repository.js';
import { AppError, ErrorCode } from '../../shared/errors/index.js';
import type { TranscriptPageDto } from '../../types/transcript.type.js';
import { getSource } from '../sources/source.service.js';

export interface TranscriptPageQuery {
  limit: number;
  cursor?: number;
  query?: string;
  aroundSeconds?: number;
}

export type TranscriptExportFormat = 'txt' | 'srt' | 'vtt';

function formatTimestamp(seconds: number, separator: '.' | ','): string {
  const millisecondsTotal = Math.max(0, Math.floor(seconds * 1000));
  const hours = Math.floor(millisecondsTotal / 3_600_000);
  const minutes = Math.floor((millisecondsTotal % 3_600_000) / 60_000);
  const remainingSeconds = Math.floor((millisecondsTotal % 60_000) / 1000);
  const milliseconds = millisecondsTotal % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}${separator}${String(milliseconds).padStart(3, '0')}`;
}

function formatTranscriptExport(
  segments: StoredTranscriptSegment[],
  format: TranscriptExportFormat,
): string {
  if (format === 'txt') {
    return segments
      .map((segment) => `[${formatTimestamp(segment.startSeconds, ',').split(',')[0]}] ${segment.text}`)
      .join('\n');
  }

  const cues = segments.map((segment, index) => {
    const start = formatTimestamp(segment.startSeconds, ',');
    const end = formatTimestamp(segment.startSeconds + segment.durationSeconds, ',');
    return `${index + 1}\n${start} --> ${end}\n${segment.text}`;
  });

  if (format === 'srt') return cues.join('\n\n');

  return `WEBVTT\n\n${segments
    .map((segment) => {
      const start = formatTimestamp(segment.startSeconds, '.');
      const end = formatTimestamp(segment.startSeconds + segment.durationSeconds, '.');
      return `${start} --> ${end}\n${segment.text}`;
    })
    .join('\n\n')}`;
}

export async function getSourceTranscriptPage(
  sourceId: number,
  query: TranscriptPageQuery,
): Promise<TranscriptPageDto> {
  const source = await getSource(sourceId);
  if (source.status !== 'READY') {
    throw new AppError(
      'The transcript is available after the source finishes processing.',
      ErrorCode.SOURCE_NOT_READY,
      409,
      { sourceId },
    );
  }

  const metadata = await getTranscriptMetadata(sourceId);
  if (!metadata || metadata.status !== 'READY') {
    return {
      status: metadata?.status ?? 'NOT_AVAILABLE',
      languageCode: metadata?.languageCode ?? null,
      retrievalMethod: metadata?.retrievalMethod ?? null,
      segmentCount: metadata?.segmentCount ?? 0,
      fetchedAt: metadata?.fetchedAt?.toISOString() ?? null,
      failure: metadata?.failure ?? null,
      segments: [],
      nextCursor: null,
    };
  }

  const result = await listTranscriptSegments(sourceId, query);
  const lastSegment = result.segments.at(-1);

  return {
    status: 'READY',
    languageCode: metadata.languageCode,
    retrievalMethod: metadata.retrievalMethod,
    segmentCount: metadata.segmentCount,
    fetchedAt: metadata.fetchedAt?.toISOString() ?? null,
    failure: null,
    segments: result.segments,
    nextCursor: result.hasMore && lastSegment ? lastSegment.segmentIndex + 1 : null,
  };
}

export async function startSourceTranscriptRefresh(
  sourceId: number,
): Promise<{ status: 'QUEUED' | 'PROCESSING' | 'READY' }> {
  const result = await requestTranscriptRefresh(sourceId);
  if (!result) {
    throw new AppError('Source was not found.', ErrorCode.SOURCE_NOT_FOUND, 404, { sourceId });
  }

  return result;
}

export async function exportSourceTranscript(
  sourceId: number,
  format: TranscriptExportFormat,
): Promise<{ body: string; contentType: string; filename: string }> {
  const source = await getSource(sourceId);
  if (source.status !== 'READY') {
    throw new AppError('The transcript is not ready to export.', ErrorCode.SOURCE_NOT_READY, 409, { sourceId });
  }

  const metadata = await getTranscriptMetadata(sourceId);
  if (!metadata || metadata.status !== 'READY') {
    throw new AppError('The transcript is not available yet.', ErrorCode.TRANSCRIPT_NOT_AVAILABLE, 409, { sourceId });
  }

  const segments = await listAllTranscriptSegments(sourceId);
  if (segments.length !== metadata.segmentCount) {
    throw new AppError(
      'The saved transcript is incomplete. Refresh the source transcript and try again.',
      ErrorCode.TRANSCRIPT_NOT_AVAILABLE,
      409,
      { sourceId },
    );
  }

  const extensions: Record<TranscriptExportFormat, string> = { txt: 'text/plain', srt: 'application/x-subrip', vtt: 'text/vtt' };
  return {
    body: formatTranscriptExport(segments, format),
    contentType: `${extensions[format]}; charset=utf-8`,
    filename: `vidscribe-source-${sourceId}-transcript.${format}`,
  };
}
