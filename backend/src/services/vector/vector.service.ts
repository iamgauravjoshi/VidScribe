// Save chunks and implement vector search

import { pool } from '../../db/postgres.js';
import { RetrievedChunk, RetrievedChunkRow } from '../../types/chunk.type.js';

export async function searchSimilarChunks(
  videoId: number,
  queryEmbedding: number[],
  limit = 3,
): Promise<RetrievedChunkRow[]> {
  const result = await pool.query(
    `
      SELECT
        vc.id,
        vc.video_id,
        vc.chunk_index,
        vc.content,
        vc.start_time_seconds,
        vc.end_time_seconds,

        v.youtube_video_id,
        v.title,
        v.url,

        1 - (vc.embedding <=> $1::vector) AS similarity
      FROM video_chunks vc
      INNER JOIN videos v
          ON v.id = vc.video_id
      WHERE vc.video_id = $2
      ORDER BY vc.embedding <=> $1::vector
      LIMIT $3;
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

export function mapRetrievedChunk(row: RetrievedChunkRow): RetrievedChunk {
  return {
    chunkId: row.id,
    videoId: row.video_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    startTimeSeconds: row.start_time_seconds,
    endTimeSeconds: row.end_time_seconds,
    similarity: row.similarity,

    source: {
      youtubeVideoId: row.youtube_video_id,
      title: row.title,
      url: row.url,
    },
  };
}
