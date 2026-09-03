// Save chunks and implement vector search

import { pool } from '../../db/postgres.js';

export async function saveChunk(
  videoId: number,
  chunkIndex: number,
  content: string,
  embedding: number[],
  startTime: number | null,
  endTime: number | null,
) {
  await pool.query(
    `
      INSERT INTO video_chunks (
        video_id,
        chunk_index,
        content,
        start_time_seconds,
        end_time_seconds,
        embedding
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [videoId, chunkIndex, content, startTime, endTime, JSON.stringify(embedding)],
  );
}

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
