// Save chunks and implement vector search

import { pool } from '../../db/postgres.js';

export async function searchSimilarChunks(videoId: number, queryEmbedding: number[], limit = 3) {
  const result = await pool.query(
    `
      SELECT
        id,
        content,
        start_time_seconds,
        end_time_seconds,
        1 - (embedding <=> $1::vector) AS similarity
      FROM video_chunks
      WHERE video_id = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `,
    [JSON.stringify(queryEmbedding), videoId, limit],
  );

  return result.rows;
}

/*
However, structurally I would eventually move: searchSimilarChunks()

into: repositories/chunk.repository.ts

because it is database access.
That will happen naturally when we improve retrieval in later steps.
*/
