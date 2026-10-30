import type { PoolClient } from 'pg';

import { pool } from '../db/postgres.js';
import { withTransaction } from '../db/transaction.js';
import { SourceStatus, SourceType, type SourceRecord } from '../types/source.type.js';

interface SourceRow {
  id: number;
  source_type: SourceType;
  external_id: string;
  canonical_url: string;
  title: string | null;
  processing_status: SourceRecord['status'];
  processing_phase: SourceRecord['phase'];
  processing_error_code: string | null;
  processing_error_message: string | null;
  processing_retryable: boolean;
  attempt_count: number | null;
  retry_count: number | null;
  created_at: Date;
  updated_at: Date;
}

const SOURCE_COLUMNS = `
  s.id,
  s.source_type,
  s.external_id,
  s.canonical_url,
  s.title,
  s.processing_status,
  s.processing_phase,
  s.processing_error_code,
  s.processing_error_message,
  s.processing_retryable,
  j.attempt_count,
  j.retry_count,
  s.created_at,
  s.updated_at
`;

function mapSourceRow(row: SourceRow): SourceRecord {
  const status = row.processing_status;

  return {
    id: row.id,
    type: row.source_type,
    externalId: row.external_id,
    canonicalUrl: row.canonical_url,
    title: row.title,
    status,
    phase: row.processing_phase,
    failure:
      status === SourceStatus.FAILED && row.processing_error_code
        ? {
            code: row.processing_error_code,
            message: row.processing_error_message ?? 'Source processing failed.',
            retryable: row.processing_retryable,
          }
        : null,
    attemptCount: row.attempt_count ?? 0,
    retryCount: row.retry_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createOrGetSourceWithClient(
  client: PoolClient,
  input: { type: SourceType; externalId: string; canonicalUrl: string; maxAttempts: number },
): Promise<{ source: SourceRecord; created: boolean }> {
  const inserted = await client.query<SourceRow>(
    `
      INSERT INTO sources (
        source_type,
        external_id,
        canonical_url,
        processing_status
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (source_type, external_id) DO NOTHING
      RETURNING
        id,
        source_type,
        external_id,
        canonical_url,
        title,
        processing_status,
        processing_phase,
        processing_error_code,
        processing_error_message,
        processing_retryable,
        created_at,
        updated_at
    `,
    [input.type, input.externalId, input.canonicalUrl, SourceStatus.QUEUED],
  );

  if (inserted.rows[0]) {
    const source = inserted.rows[0];

    await client.query(
      `
        INSERT INTO ingestion_jobs (source_id, status, max_attempts)
        VALUES ($1, 'QUEUED', $2)
        ON CONFLICT (source_id) DO NOTHING
      `,
      [source.id, input.maxAttempts],
    );
    await client.query(
      'INSERT INTO conversations (source_id) VALUES ($1) ON CONFLICT (source_id) DO NOTHING',
      [source.id],
    );

    return {
      source: mapSourceRow({ ...source, attempt_count: 0, retry_count: 0 }),
      created: true,
    };
  }

  const existing = await client.query<SourceRow>(
    `
      SELECT ${SOURCE_COLUMNS}
      FROM sources AS s
      LEFT JOIN ingestion_jobs AS j ON j.source_id = s.id
      WHERE s.source_type = $1 AND s.external_id = $2
      FOR UPDATE OF s
    `,
    [input.type, input.externalId],
  );

  if (!existing.rows[0]) {
    throw new Error('The source was not inserted or found after a unique-key conflict.');
  }

  await client.query(
    'INSERT INTO conversations (source_id) VALUES ($1) ON CONFLICT (source_id) DO NOTHING',
    [existing.rows[0].id],
  );

  return { source: mapSourceRow(existing.rows[0]), created: false };
}

export async function findSourceById(id: number): Promise<SourceRecord | null> {
  const result = await pool.query<SourceRow>(
    `
      SELECT ${SOURCE_COLUMNS}
      FROM sources AS s
      LEFT JOIN ingestion_jobs AS j ON j.source_id = s.id
      WHERE s.id = $1
    `,
    [id],
  );

  return result.rows[0] ? mapSourceRow(result.rows[0]) : null;
}

export async function findSourceByIdWithClient(
  client: PoolClient,
  id: number,
): Promise<SourceRecord | null> {
  const result = await client.query<SourceRow>(
    `
      SELECT ${SOURCE_COLUMNS}
      FROM sources AS s
      LEFT JOIN ingestion_jobs AS j ON j.source_id = s.id
      WHERE s.id = $1
      FOR UPDATE OF s
    `,
    [id],
  );

  return result.rows[0] ? mapSourceRow(result.rows[0]) : null;
}

export async function listSources(): Promise<SourceRecord[]> {
  const result = await pool.query<SourceRow>(
    `
      SELECT ${SOURCE_COLUMNS}
      FROM sources AS s
      LEFT JOIN ingestion_jobs AS j ON j.source_id = s.id
      ORDER BY s.updated_at DESC, s.id DESC
    `,
  );

  return result.rows.map(mapSourceRow);
}

export async function deleteSource(sourceId: number): Promise<boolean> {
  return withTransaction(async (client) => {
    await client.query('SELECT id FROM ingestion_jobs WHERE source_id = $1 FOR UPDATE', [sourceId]);

    const result = await client.query('DELETE FROM sources WHERE id = $1 RETURNING id', [sourceId]);

    return result.rowCount === 1;
  });
}
