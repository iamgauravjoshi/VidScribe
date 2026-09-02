/* 
Create ingestion service
Now we combine: Transcript + Chunking + Embeddings + Database
*/

import { pool } from "../../db/postgres.js";
import { getTranscript } from "../youtube/youtube.service.js";
import { createChunks } from "./chunk.service.js";
import { generateEmbedding } from "../embeddings/embedding.service.js";
import { saveChunk } from "../vector/vector.service.js";

export async function ingestVideo(url: string) {
  const { videoId, transcript } =
    await getTranscript(url);

  const existingVideo =
    await pool.query(
      `
        SELECT id
        FROM videos
        WHERE youtube_video_id = $1
      `,
      [videoId]
    );

  if (existingVideo.rows.length > 0) {
    return {
      videoId,
      databaseId: existingVideo.rows[0].id,
      alreadyProcessed: true
    };
  }

  const videoResult = await pool.query(
    `
      INSERT INTO videos (
        youtube_video_id,
        url
      )
      VALUES ($1, $2)
      RETURNING id
    `,
    [videoId, url]
  );

  const databaseVideoId =
    videoResult.rows[0].id;

  const chunks = createChunks(transcript, 2000);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    const embedding =
      await generateEmbedding(chunk.content);

    await saveChunk(
      databaseVideoId,
      i,
      chunk.content,
      embedding,
      chunk.startTime,
      chunk.endTime
    );
  }

  return {
    videoId,
    databaseId: databaseVideoId,
    chunksProcessed: chunks.length,
    alreadyProcessed: false
  };
}