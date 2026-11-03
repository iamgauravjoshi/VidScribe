import type { PoolClient } from 'pg';

import { pool } from '../db/postgres.js';
import type { TranscriptSegment } from '../types/transcript.type.js';

export type StoredTranscriptStatus = 'PROCESSING' | 'READY' | 'FAILED';

export interface TranscriptMetadataRecord {
  status: StoredTranscriptStatus;
  languageCode: string | null;
  retrievalMethod: 'youtube_captions';
  segmentCount: number;
  fetchedAt: Date | null;
  failure: { code: string; message: string; retryable: boolean } | null;
}

export interface StoredTranscriptSegment {
  segmentIndex: number;
  startSeconds: number;
  durationSeconds: number;
  text: string;
}

interface TranscriptMetadataRow {
  status: StoredTranscriptStatus;
  language_code: string | null;
  retrieval_method: 'youtube_captions';
  segment_count: number;
  fetched_at: Date | null;
  failure_code: string | null;
  failure_message: string | null;
  failure_retryable: boolean;
}

interface TranscriptSegmentRow {
  segment_index: number;
  start_seconds: number;
  duration_seconds: number;
  text: string;
}

function mapMetadata(row: TranscriptMetadataRow): TranscriptMetadataRecord {
  return {
    status: row.status,
    languageCode: row.language_code,
    retrievalMethod: row.retrieval_method,
    segmentCount: row.segment_count,
    fetchedAt: row.fetched_at,
    failure:
      row.status === 'FAILED' && row.failure_code && row.failure_message
        ? {
            code: row.failure_code,
            message: row.failure_message,
            retryable: row.failure_retryable,
          }
        : null,
  };
}

function mapSegment(row: TranscriptSegmentRow): StoredTranscriptSegment {
  return {
    segmentIndex: row.segment_index,
    startSeconds: row.start_seconds,
    durationSeconds: row.duration_seconds,
    text: row.text,
  };
}

export async function getTranscriptMetadata(sourceId: number): Promise<TranscriptMetadataRecord | null> {
  const result = await pool.query<TranscriptMetadataRow>(
    `
      SELECT
        status,
        language_code,
        retrieval_method,
        segment_count,
        fetched_at,
        failure_code,
        failure_message,
        failure_retryable
      FROM source_transcripts
      WHERE source_id = $1
    `,
    [sourceId],
  );

  return result.rows[0] ? mapMetadata(result.rows[0]) : null;
}

export async function getTranscriptMetadataWithClient(
  client: PoolClient,
  sourceId: number,
): Promise<TranscriptMetadataRecord | null> {
  const result = await client.query<TranscriptMetadataRow>(
    `
      SELECT
        status,
        language_code,
        retrieval_method,
        segment_count,
        fetched_at,
        failure_code,
        failure_message,
        failure_retryable
      FROM source_transcripts
      WHERE source_id = $1
      FOR UPDATE
    `,
    [sourceId],
  );

  return result.rows[0] ? mapMetadata(result.rows[0]) : null;
}

export async function listTranscriptSegments(
  sourceId: number,
  input: { limit: number; cursor?: number; query?: string; aroundSeconds?: number },
): Promise<{ segments: StoredTranscriptSegment[]; hasMore: boolean }> {
  let cursor = input.cursor;

  if (input.aroundSeconds !== undefined) {
    const nearest = await pool.query<{ segment_index: number }>(
      `
        SELECT segment_index
        FROM source_transcript_segments
        WHERE source_id = $1
        ORDER BY ABS(start_seconds - $2), segment_index
        LIMIT 1
      `,
      [sourceId, input.aroundSeconds],
    );

    if (nearest.rows[0]) {
      cursor = Math.max(0, nearest.rows[0].segment_index - Math.floor(input.limit / 2));
    }
  }

  const result = await pool.query<TranscriptSegmentRow>(
    `
      SELECT segment_index, start_seconds, duration_seconds, text
      FROM source_transcript_segments
      WHERE source_id = $1
        AND ($2::INTEGER IS NULL OR segment_index >= $2)
        AND (
          $3::TEXT IS NULL
          OR TO_TSVECTOR('english', text) @@ WEBSEARCH_TO_TSQUERY('english', $3)
        )
      ORDER BY segment_index
      LIMIT $4
    `,
    [sourceId, cursor ?? null, input.query ?? null, input.limit + 1],
  );

  const hasMore = result.rows.length > input.limit;
  const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows;

  return { segments: rows.map(mapSegment), hasMore };
}

export async function listAllTranscriptSegments(sourceId: number): Promise<StoredTranscriptSegment[]> {
  const result = await pool.query<TranscriptSegmentRow>(
    `
      SELECT segment_index, start_seconds, duration_seconds, text
      FROM source_transcript_segments
      WHERE source_id = $1
      ORDER BY segment_index
    `,
    [sourceId],
  );

  return result.rows.map(mapSegment);
}

export async function markTranscriptRefreshQueuedWithClient(
  client: PoolClient,
  sourceId: number,
): Promise<void> {
  await client.query(
    `
      INSERT INTO source_transcripts (source_id, status, retrieval_method)
      VALUES ($1, 'PROCESSING', 'youtube_captions')
      ON CONFLICT (source_id) DO UPDATE
      SET status = 'PROCESSING',
          language_code = NULL,
          segment_count = 0,
          fetched_at = NULL,
          failure_code = NULL,
          failure_message = NULL,
          failure_retryable = FALSE,
          updated_at = NOW()
    `,
    [sourceId],
  );
}

export async function persistTranscriptWithClient(
  client: PoolClient,
  sourceId: number,
  segments: TranscriptSegment[],
  languageCode: string,
): Promise<void> {
  if (segments.length === 0) {
    throw new Error('A source cannot publish an empty transcript.');
  }

  await client.query('DELETE FROM source_transcript_segments WHERE source_id = $1', [sourceId]);
  await client.query(
    `
      INSERT INTO source_transcripts (
        source_id,
        status,
        language_code,
        retrieval_method,
        segment_count,
        fetched_at,
        failure_code,
        failure_message,
        failure_retryable,
        updated_at
      )
      VALUES ($1, 'READY', $2, 'youtube_captions', $3, NOW(), NULL, NULL, FALSE, NOW())
      ON CONFLICT (source_id) DO UPDATE
      SET status = EXCLUDED.status,
          language_code = EXCLUDED.language_code,
          retrieval_method = EXCLUDED.retrieval_method,
          segment_count = EXCLUDED.segment_count,
          fetched_at = EXCLUDED.fetched_at,
          failure_code = NULL,
          failure_message = NULL,
          failure_retryable = FALSE,
          updated_at = NOW()
    `,
    [sourceId, languageCode, segments.length],
  );

  const rows = segments.map((segment, segmentIndex) => ({
    segment_index: segmentIndex,
    start_seconds: segment.start,
    duration_seconds: segment.duration,
    text: segment.text.trim(),
  }));

  await client.query(
    `
      INSERT INTO source_transcript_segments (
        source_id,
        segment_index,
        start_seconds,
        duration_seconds,
        text
      )
      SELECT $1, segment_index, start_seconds, duration_seconds, text
      FROM JSONB_TO_RECORDSET($2::JSONB) AS segment(
        segment_index INTEGER,
        start_seconds DOUBLE PRECISION,
        duration_seconds DOUBLE PRECISION,
        text TEXT
      )
    `,
    [sourceId, JSON.stringify(rows)],
  );
}

export async function markTranscriptRefreshFailedWithClient(
  client: PoolClient,
  sourceId: number,
  failure: { code: string; message: string; retryable: boolean },
): Promise<void> {
  await client.query(
    `
      UPDATE source_transcripts
      SET status = 'FAILED',
          failure_code = $2,
          failure_message = $3,
          failure_retryable = $4,
          updated_at = NOW()
      WHERE source_id = $1
    `,
    [sourceId, failure.code, failure.message, failure.retryable],
  );
}
