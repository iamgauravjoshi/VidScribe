import type { PoolClient } from 'pg';
import { pool } from '../db/postgres.js';

export interface CreateChunkInput {
  sourceId: number;
  chunkIndex: number;
  content: string;
  embedding?: number[] | null;
  startSeconds: number | null;
  endSeconds: number | null;
}

export async function createChunk(input: CreateChunkInput): Promise<void> {
  await pool.query(
    `
      INSERT INTO source_chunks (
        source_id,
        chunk_index,
        content,
        start_seconds,
        end_seconds,
        embedding
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      input.sourceId,
      input.chunkIndex,
      input.content,
      input.startSeconds,
      input.endSeconds,
      serializeEmbedding(input.embedding),
    ],
  );
}

export async function createChunkWithClient(
  client: PoolClient,
  input: CreateChunkInput,
): Promise<void> {
  await client.query(
    `
      INSERT INTO source_chunks (
        source_id,
        chunk_index,
        content,
        start_seconds,
        end_seconds,
        embedding
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      input.sourceId,
      input.chunkIndex,
      input.content,
      input.startSeconds,
      input.endSeconds,
      serializeEmbedding(input.embedding),
    ],
  );
}

function serializeEmbedding(embedding: number[] | null | undefined): string | null {
  if (embedding === null || embedding === undefined) return null;
  if (embedding.length === 0) throw new Error('A vector embedding cannot be empty.');
  return JSON.stringify(embedding);
}
