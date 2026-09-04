import { pool } from '../db/postgres.js';

export interface CreateChunkInput {
  videoId: number;
  chunkIndex: number;
  content: string;
  embedding: number[];
  startTimeSeconds: number | null;
  endTimeSeconds: number | null;
}

export async function createChunk(input: CreateChunkInput): Promise<void> {
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
    [
      input.videoId,
      input.chunkIndex,
      input.content,
      input.startTimeSeconds,
      input.endTimeSeconds,
      JSON.stringify(input.embedding),
    ],
  );
}
