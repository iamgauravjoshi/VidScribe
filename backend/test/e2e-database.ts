import { randomUUID } from 'node:crypto';
import pg, { type Pool, type PoolClient } from 'pg';

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('E2E fixture ID exceeds the safe integer range.');
  return parsed;
});

export type E2eSourceScenario = 'transcript-ready' | 'legacy' | 'legacy-nonretryable';

export interface E2eSource {
  id: number;
  externalId: string;
  canonicalUrl: string;
}

export function assertDedicatedTestDatabase(connectionString: string | undefined): asserts connectionString is string {
  if (!connectionString) {
    throw new Error('VIDSCRIBE_TEST_DATABASE_URL is required. Run the suite with npm run test:e2e.');
  }

  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (databaseName !== 'vidscribe_test' || !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('E2E tests only run against the dedicated vidscribe_test PostgreSQL database.');
  }

  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error('E2E tests only run against a loopback PostgreSQL host.');
  }
}

export function createE2ePool(connectionString = process.env.VIDSCRIBE_TEST_DATABASE_URL): Pool {
  assertDedicatedTestDatabase(connectionString);
  return new pg.Pool({ connectionString });
}

export async function resetE2eSources(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE TABLE public.sources RESTART IDENTITY CASCADE');
}

async function withClientTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function segmentText(index: number): string {
  if (index === 123) return 'Transcript segment 123 contains searchneedleomega as a unique searchable phrase.';
  if (index === 124) return 'Transcript segment 124 contains the citation marker at ten minutes and twenty seconds.';
  return `Transcript segment ${index} discusses useful learning ideas and examples.`;
}

export async function seedE2eSource(
  pool: Pool,
  scenario: E2eSourceScenario = 'transcript-ready',
): Promise<E2eSource> {
  return withClientTransaction(pool, async (client) => {
    const externalId = randomUUID().replaceAll('-', '').slice(0, 11);
    const canonicalUrl = `https://www.youtube.com/watch?v=${externalId}`;
    const sourceResult = await client.query<{ id: number }>(
      `
        INSERT INTO public.sources (
          source_type, external_id, canonical_url, title, processing_status
        )
        VALUES ('youtube', $1, $2, 'Automated transcript test source', 'READY')
        RETURNING id
      `,
      [externalId, canonicalUrl],
    );
    const sourceId = sourceResult.rows[0]!.id;

    await client.query(
      `
        INSERT INTO public.ingestion_jobs (
          source_id, status, attempt_count, retry_count, max_attempts,
          operation, completed_at
        )
        VALUES ($1, $2, 1, 0, 3, $3, CASE WHEN $2 = 'COMPLETED' THEN NOW() ELSE NULL END)
      `,
      [
        sourceId,
        scenario === 'legacy-nonretryable' ? 'FAILED' : 'COMPLETED',
        scenario === 'legacy-nonretryable' ? 'TRANSCRIPT_REFRESH' : 'INGEST_SOURCE',
      ],
    );

    const conversationResult = await client.query<{ id: number }>(
      'INSERT INTO public.conversations (source_id) VALUES ($1) RETURNING id',
      [sourceId],
    );
    const conversationId = conversationResult.rows[0]!.id;

    await client.query(
      `
        INSERT INTO public.source_chunks (source_id, chunk_index, content, start_seconds, end_seconds, embedding)
        VALUES ($1, 0, 'Existing indexed source content for the legacy source.', 0, 5, NULL)
      `,
      [sourceId],
    );

    if (scenario === 'transcript-ready') {
      const segments = Array.from({ length: 160 }, (_, index) => ({
        segment_index: index,
        start_seconds: index * 5,
        duration_seconds: 4,
        text: segmentText(index),
      }));

      await client.query(
        `
          INSERT INTO public.source_transcripts (
            source_id, status, language_code, retrieval_method,
            segment_count, fetched_at
          )
          VALUES ($1, 'READY', 'en', 'youtube_captions', $2, NOW())
        `,
        [sourceId, segments.length],
      );
      await client.query(
        `
          INSERT INTO public.source_transcript_segments (
            source_id, segment_index, start_seconds, duration_seconds, text
          )
          SELECT $1, segment_index, start_seconds, duration_seconds, text
          FROM JSONB_TO_RECORDSET($2::JSONB) AS segment(
            segment_index INTEGER,
            start_seconds DOUBLE PRECISION,
            duration_seconds DOUBLE PRECISION,
            text TEXT
          )
        `,
        [sourceId, JSON.stringify(segments)],
      );

      const turnId = randomUUID();
      await client.query(
        `
          INSERT INTO public.messages (
            conversation_id, turn_id, role, status, content, citations, finished_at
          )
          VALUES ($1, $2, 'ASSISTANT', 'COMPLETED', $3, $4::JSONB, NOW())
        `,
        [
          conversationId,
          turnId,
          'The test answer is grounded in the citation marker in the transcript.',
          JSON.stringify([{
            id: 'e2e-citation-1',
            startSeconds: 620,
            endSeconds: 624,
            excerpt: 'citation marker at ten minutes and twenty seconds',
            href: `${canonicalUrl}&t=620s`,
          }]),
        ],
      );
    } else if (scenario === 'legacy-nonretryable') {
      await client.query(
        `
          INSERT INTO public.source_transcripts (
            source_id, status, failure_code, failure_message, failure_retryable
          )
          VALUES ($1, 'FAILED', 'CAPTIONS_UNAVAILABLE', 'Captions are unavailable for this source.', FALSE)
        `,
        [sourceId],
      );
    }

    return { id: sourceId, externalId, canonicalUrl };
  });
}

export async function recordRefreshFailure(pool: Pool, sourceId: number): Promise<void> {
  await withClientTransaction(pool, async (client) => {
    await client.query(
      `
        UPDATE public.source_transcripts
        SET status = 'FAILED',
            failure_code = 'CAPTIONS_TEMPORARILY_UNAVAILABLE',
            failure_message = 'Captions are temporarily unavailable. Please retry.',
            failure_retryable = TRUE,
            updated_at = NOW()
        WHERE source_id = $1
      `,
      [sourceId],
    );
    await client.query(
      `
        UPDATE public.ingestion_jobs
        SET status = 'FAILED', operation = 'TRANSCRIPT_REFRESH',
            lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
            completed_at = NULL, updated_at = NOW()
        WHERE source_id = $1
      `,
      [sourceId],
    );
  });
}

export async function publishRefreshedTranscript(pool: Pool, sourceId: number): Promise<void> {
  await withClientTransaction(pool, async (client) => {
    await client.query(
      'DELETE FROM public.source_transcript_segments WHERE source_id = $1',
      [sourceId],
    );
    await client.query(
      `
        UPDATE public.source_transcripts
        SET status = 'READY', language_code = 'en', segment_count = 1,
            fetched_at = NOW(), failure_code = NULL, failure_message = NULL,
            failure_retryable = FALSE, updated_at = NOW()
        WHERE source_id = $1
      `,
      [sourceId],
    );
    await client.query(
      `
        INSERT INTO public.source_transcript_segments (
          source_id, segment_index, start_seconds, duration_seconds, text
        ) VALUES ($1, 0, 0, 4, 'A newly refreshed transcript moment is ready.')
      `,
      [sourceId],
    );
    await client.query(
      `
        UPDATE public.ingestion_jobs
        SET status = 'COMPLETED', operation = 'TRANSCRIPT_REFRESH',
            lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
            completed_at = NOW(), updated_at = NOW()
        WHERE source_id = $1
      `,
      [sourceId],
    );
  });
}

export async function deleteE2eSource(pool: Pool, sourceId: number): Promise<void> {
  await pool.query('DELETE FROM public.sources WHERE id = $1', [sourceId]);
}
