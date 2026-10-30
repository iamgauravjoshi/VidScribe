import { pool } from '../db/postgres.js';
import type { RetrievedChunkRow } from '../types/chunk.type.js';

export async function searchSourceChunksByText(
  sourceId: number,
  question: string,
  limit: number,
): Promise<RetrievedChunkRow[]> {
  const result = await pool.query<RetrievedChunkRow>(
    `
      WITH search_terms AS (
        SELECT replace(
          plainto_tsquery('english'::regconfig, $2)::TEXT,
          ' & ',
          ' | '
        )::tsquery AS query
      )
      SELECT
        sc.id,
        sc.source_id,
        sc.chunk_index,
        sc.content,
        sc.start_seconds,
        sc.end_seconds,
        s.external_id,
        s.title,
        s.canonical_url,
        ts_rank_cd(
          to_tsvector('english'::regconfig, sc.content),
          search_terms.query
        )::DOUBLE PRECISION AS "relevanceScore"
      FROM source_chunks AS sc
      INNER JOIN sources AS s ON s.id = sc.source_id
      CROSS JOIN search_terms
      WHERE sc.source_id = $1
        AND search_terms.query <> ''::tsquery
        AND to_tsvector('english'::regconfig, sc.content) @@ search_terms.query
      ORDER BY "relevanceScore" DESC, sc.chunk_index ASC
      LIMIT $3
    `,
    [sourceId, question, limit],
  );

  return result.rows;
}
