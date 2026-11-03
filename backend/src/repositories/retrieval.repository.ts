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
        )::tsquery AS any_query,
        plainto_tsquery('english'::regconfig, $2) AS full_query,
        phraseto_tsquery('english'::regconfig, $2) AS phrase_query
      ),
      matching_chunks AS (
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
          search_terms.any_query,
          search_terms.full_query,
          search_terms.phrase_query,
          to_tsvector('english'::regconfig, sc.content) AS document_vector
        FROM source_chunks AS sc
        INNER JOIN sources AS s ON s.id = sc.source_id
        CROSS JOIN search_terms
        WHERE sc.source_id = $1
          AND search_terms.any_query <> ''::tsquery
          AND to_tsvector('english'::regconfig, sc.content) @@ search_terms.any_query
      ),
      ranked_chunks AS MATERIALIZED (
        SELECT
          matching_chunks.*,
          (document_vector @@ phrase_query) AS phrase_match,
          (document_vector @@ full_query) AS full_query_match,
          ts_rank_cd(document_vector, any_query)::DOUBLE PRECISION AS "relevanceScore",
          ts_rank_cd(document_vector, any_query, 2)::DOUBLE PRECISION AS rerank_relevance_score
        FROM matching_chunks
        ORDER BY
          "relevanceScore" DESC,
          chunk_index ASC
        LIMIT $3
      )
      SELECT
        ranked_chunks.id,
        ranked_chunks.source_id,
        ranked_chunks.chunk_index,
        ranked_chunks.content,
        ranked_chunks.start_seconds,
        ranked_chunks.end_seconds,
        ranked_chunks.external_id,
        ranked_chunks.title,
        ranked_chunks.canonical_url,
        ranked_chunks."relevanceScore",
        ranked_chunks.phrase_match,
        ranked_chunks.full_query_match,
        citation_segment.segment_index AS citation_segment_index,
        citation_segment.start_seconds AS citation_start_seconds,
        citation_segment.end_seconds AS citation_end_seconds,
        citation_segment.text AS citation_excerpt,
        citation_segment.phrase_match AS citation_phrase_match,
        citation_segment.full_query_match AS citation_full_query_match,
        citation_segment.relevance_score AS citation_relevance_score
      FROM ranked_chunks
      LEFT JOIN LATERAL (
        SELECT
          transcript_segment.segment_index,
          transcript_segment.start_seconds,
          transcript_segment.start_seconds + transcript_segment.duration_seconds AS end_seconds,
          transcript_segment.text,
          (to_tsvector('english'::regconfig, transcript_segment.text) @@ ranked_chunks.phrase_query) AS phrase_match,
          (to_tsvector('english'::regconfig, transcript_segment.text) @@ ranked_chunks.full_query) AS full_query_match,
          ts_rank_cd(
            to_tsvector('english'::regconfig, transcript_segment.text),
            ranked_chunks.any_query,
            2
          )::DOUBLE PRECISION AS relevance_score
        FROM source_transcript_segments AS transcript_segment
        WHERE transcript_segment.source_id = ranked_chunks.source_id
          AND transcript_segment.start_seconds >= ranked_chunks.start_seconds
          AND transcript_segment.start_seconds <= ranked_chunks.end_seconds
          AND to_tsvector('english'::regconfig, transcript_segment.text) @@ ranked_chunks.any_query
        ORDER BY
          phrase_match DESC,
          full_query_match DESC,
          relevance_score DESC,
          transcript_segment.segment_index ASC
        LIMIT 1
      ) AS citation_segment ON TRUE
      ORDER BY
        (COALESCE(citation_segment.phrase_match, FALSE) OR ranked_chunks.phrase_match) DESC,
        (COALESCE(citation_segment.full_query_match, FALSE) OR ranked_chunks.full_query_match) DESC,
        COALESCE(citation_segment.relevance_score, ranked_chunks.rerank_relevance_score) DESC,
        ranked_chunks."relevanceScore" DESC,
        ranked_chunks.chunk_index ASC
      LIMIT $3
    `,
    [sourceId, question, limit],
  );

  return result.rows;
}
