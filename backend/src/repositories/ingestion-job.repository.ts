import { randomUUID } from 'node:crypto';
import { pool } from '../db/postgres.js';
import { withTransaction } from '../db/transaction.js';
import { createChunkWithClient, type CreateChunkInput } from './chunk.repository.js';
import { AppError, ErrorCode } from '../shared/errors/index.js';
import { SourceStatus, type SourceRecord, type SourceType } from '../types/source.type.js';
import { findSourceByIdWithClient } from './source.repository.js';

export interface ClaimedIngestionJob {
  id: number;
  sourceId: number;
  sourceType: SourceType;
  externalId: string;
  canonicalUrl: string;
  title: string | null;
  attemptCount: number;
  leaseToken: string;
}

interface CandidateJobRow {
  id: number;
  source_id: number;
  attempt_count: number;
  max_attempts: number;
  source_type: SourceType;
  external_id: string;
  canonical_url: string;
  title: string | null;
}

export class ProcessingLeaseLostError extends Error {
  constructor() {
    super('The ingestion job lease is no longer owned by this worker.');
    this.name = 'ProcessingLeaseLostError';
  }
}

export async function claimNextIngestionJob(
  workerId: string,
  leaseDurationMs: number,
): Promise<ClaimedIngestionJob | null> {
  return withTransaction(async (client) => {
    const result = await client.query<CandidateJobRow>(
      `
        SELECT
          j.id,
          j.source_id,
          j.attempt_count,
          j.max_attempts,
          s.source_type,
          s.external_id,
          s.canonical_url,
          s.title
        FROM ingestion_jobs AS j
        INNER JOIN sources AS s ON s.id = j.source_id
        WHERE (
          (j.status = 'QUEUED' AND j.available_at <= NOW())
          OR (j.status = 'PROCESSING' AND j.lease_expires_at <= NOW())
        )
        ORDER BY j.available_at, j.created_at, j.id
        LIMIT 1
        FOR UPDATE OF j SKIP LOCKED
      `,
    );

    const candidate = result.rows[0];

    if (!candidate) {
      return null;
    }

    if (candidate.attempt_count >= candidate.max_attempts) {
      await client.query(
        `
          UPDATE ingestion_jobs
          SET status = 'FAILED',
              lease_token = NULL,
              lease_owner = NULL,
              lease_expires_at = NULL,
              updated_at = NOW()
          WHERE id = $1
        `,
        [candidate.id],
      );
      await client.query(
        `
          UPDATE sources
          SET processing_status = 'FAILED',
              processing_error_code = 'INGESTION_ATTEMPTS_EXHAUSTED',
              processing_error_message = 'Processing stopped after repeated worker interruptions. Retry to try again.',
              processing_retryable = TRUE,
              updated_at = NOW()
          WHERE id = $1
        `,
        [candidate.source_id],
      );

      return null;
    }

    const leaseToken = randomUUID();
    const attemptCount = candidate.attempt_count + 1;

    await client.query(
      `
        UPDATE ingestion_jobs
        SET status = 'PROCESSING',
            attempt_count = $2,
            lease_token = $3,
            lease_owner = $4,
            lease_expires_at = NOW() + ($5 * INTERVAL '1 millisecond'),
            phase = 'FETCHING_TRANSCRIPT',
            updated_at = NOW()
        WHERE id = $1
      `,
      [candidate.id, attemptCount, leaseToken, workerId, leaseDurationMs],
    );

    await client.query(
      `
        UPDATE sources
        SET processing_status = 'PROCESSING',
            processing_phase = 'FETCHING_TRANSCRIPT',
            processing_error_code = NULL,
            processing_error_message = NULL,
            processing_retryable = FALSE,
            updated_at = NOW()
        WHERE id = $1
      `,
      [candidate.source_id],
    );

    return {
      id: candidate.id,
      sourceId: candidate.source_id,
      sourceType: candidate.source_type,
      externalId: candidate.external_id,
      canonicalUrl: candidate.canonical_url,
      title: candidate.title,
      attemptCount,
      leaseToken,
    };
  });
}

export async function updateIngestionJobPhase(
  jobId: number,
  leaseToken: string,
  phase: 'FETCHING_TRANSCRIPT' | 'CHUNKING' | 'INDEXING' | 'PERSISTING',
): Promise<boolean> {
  return withTransaction(async (client) => {
    const job = await client.query<{ source_id: number }>(
      `
        SELECT source_id
        FROM ingestion_jobs
        WHERE id = $1 AND lease_token = $2 AND status = 'PROCESSING'
        FOR UPDATE
      `,
      [jobId, leaseToken],
    );
    const sourceId = job.rows[0]?.source_id;

    if (!sourceId) {
      return false;
    }

    await client.query(
      'UPDATE ingestion_jobs SET phase = $2, updated_at = NOW() WHERE id = $1',
      [jobId, phase],
    );
    await client.query(
      'UPDATE sources SET processing_phase = $2, updated_at = NOW() WHERE id = $1',
      [sourceId, phase],
    );

    return true;
  });
}

export async function renewIngestionJobLease(
  jobId: number,
  leaseToken: string,
  leaseDurationMs: number,
): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE ingestion_jobs
      SET lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
          updated_at = NOW()
      WHERE id = $1
        AND lease_token = $2
        AND status = 'PROCESSING'
      RETURNING id
    `,
    [jobId, leaseToken, leaseDurationMs],
  );

  return result.rowCount === 1;
}

export async function completeIngestionJob(
  jobId: number,
  leaseToken: string,
  chunks: CreateChunkInput[],
): Promise<void> {
  if (chunks.length === 0) {
    throw new Error('A source cannot be marked ready without indexed chunks.');
  }

  await withTransaction(async (client) => {
    const job = await client.query<{ source_id: number }>(
      `
        SELECT source_id
        FROM ingestion_jobs
        WHERE id = $1 AND lease_token = $2 AND status = 'PROCESSING'
        FOR UPDATE
      `,
      [jobId, leaseToken],
    );

    const sourceId = job.rows[0]?.source_id;

    if (!sourceId) {
      throw new ProcessingLeaseLostError();
    }

    await client.query('DELETE FROM source_chunks WHERE source_id = $1', [sourceId]);

    for (const chunk of chunks) {
      await createChunkWithClient(client, chunk);
    }

    const source = await client.query(
      `
        UPDATE sources
        SET processing_status = 'READY',
            processing_phase = NULL,
            processing_error_code = NULL,
            processing_error_message = NULL,
            processing_retryable = FALSE,
            updated_at = NOW()
        WHERE id = $1 AND processing_status = 'PROCESSING'
        RETURNING id
      `,
      [sourceId],
    );

    if (source.rowCount !== 1) {
      throw new ProcessingLeaseLostError();
    }

    const completed = await client.query(
      `
        UPDATE ingestion_jobs
        SET status = 'COMPLETED',
            lease_token = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            phase = NULL,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND status = 'PROCESSING'
        RETURNING id
      `,
      [jobId, leaseToken],
    );

    if (completed.rowCount !== 1) {
      throw new ProcessingLeaseLostError();
    }
  });
}

export async function failIngestionJob(
  jobId: number,
  leaseToken: string,
  failure: { code: string; message: string; retryable: boolean },
): Promise<boolean> {
  return withTransaction(async (client) => {
    const job = await client.query<{ source_id: number }>(
      `
        SELECT source_id
        FROM ingestion_jobs
        WHERE id = $1 AND lease_token = $2 AND status = 'PROCESSING'
        FOR UPDATE
      `,
      [jobId, leaseToken],
    );

    const sourceId = job.rows[0]?.source_id;

    if (!sourceId) {
      return false;
    }

    await client.query(
      `
        UPDATE ingestion_jobs
        SET status = 'FAILED',
            lease_token = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            phase = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [jobId],
    );
    await client.query(
      `
        UPDATE sources
        SET processing_status = 'FAILED',
            processing_phase = NULL,
            processing_error_code = $2,
            processing_error_message = $3,
            processing_retryable = $4,
            updated_at = NOW()
        WHERE id = $1
      `,
      [sourceId, failure.code, failure.message, failure.retryable],
    );

    return true;
  });
}

export async function retrySourceJob(sourceId: number): Promise<SourceRecord | null> {
  return withTransaction(async (client) => {
    const job = await client.query<{ id: number; status: string }>(
      'SELECT id, status FROM ingestion_jobs WHERE source_id = $1 FOR UPDATE',
      [sourceId],
    );

    const source = await findSourceByIdWithClient(client, sourceId);

    if (!source) {
      return null;
    }

    if (!job.rows[0]) {
      throw new Error(`Source ${sourceId} has no ingestion job.`);
    }

    if (job.rows[0].status === 'QUEUED' || job.rows[0].status === 'PROCESSING') {
      return source;
    }

    if (source.status !== SourceStatus.FAILED || !source.failure?.retryable) {
      throw new AppError(
        'This source cannot be retried automatically. Review the failure details first.',
        ErrorCode.SOURCE_RETRY_NOT_ALLOWED,
        409,
        { sourceId },
      );
    }

    await client.query(
      `
        UPDATE ingestion_jobs
        SET status = 'QUEUED',
            attempt_count = 0,
            retry_count = retry_count + 1,
            available_at = NOW(),
            lease_token = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            phase = NULL,
            completed_at = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [job.rows[0].id],
    );
    await client.query(
      `
        UPDATE sources
        SET processing_status = 'QUEUED',
            processing_phase = NULL,
            processing_error_code = NULL,
            processing_error_message = NULL,
            processing_retryable = FALSE,
            updated_at = NOW()
        WHERE id = $1
      `,
      [sourceId],
    );

    return findSourceByIdWithClient(client, sourceId);
  });
}
