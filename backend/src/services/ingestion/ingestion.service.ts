/* 
Create ingestion service
Now we combine: Transcript + Chunking + Embeddings + Database
*/

import { pool } from '../../db/postgres.js';
import { getTranscript } from '../youtube/youtube.service.js';
import { createChunks } from './chunk.service.js';
import { generateEmbedding } from '../embeddings/embedding.service.js';
import { saveChunk } from '../vector/vector.service.js';

import { VideoProcessingStatus } from '../../types/video.type.js';
import {
  createVideo,
  findVideoByYouTubeId,
  updateVideoProcessingStatus,
} from '../../repositories/video.repository.js';

export async function ingestVideo(url: string) {
  const { videoId, transcript } = await getTranscript(url);

  const existingVideo = await findVideoByYouTubeId(videoId);

  if (existingVideo) {
    return {
      videoId,
      databaseId: existingVideo.id,
      alreadyProcessed: true,
      processingStatus: existingVideo.processingStatus,
    };
  }

  const video = await createVideo(videoId, url, VideoProcessingStatus.PENDING);

  try {
    await updateVideoProcessingStatus(video.id, VideoProcessingStatus.PROCESSING);

    const chunks = createChunks(transcript, 2000);

    // for (let i = 0; i < chunks.length; i++) {
    //   const chunk = chunks[i];

    //   const embedding = await generateEmbedding(chunk.content);

    //   await saveChunk(databaseVideoId, i, chunk.content, embedding, chunk.startTime, chunk.endTime);
    // }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      const embedding = await generateEmbedding(chunk.content);

      // await createChunk({
      //   videoId: video.id,
      //   chunkIndex: i,
      //   content: chunk.content,
      //   embedding,
      //   startTimeSeconds: chunk.startTime,
      //   endTimeSeconds: chunk.endTime,
      // });

      // await saveChunk(databaseVideoId, i, chunk.content, embedding, chunk.startTime, chunk.endTime);

      await saveChunk(video.id, i, chunk.content, embedding, chunk.startTime, chunk.endTime);
    }

    await updateVideoProcessingStatus(video.id, VideoProcessingStatus.COMPLETED);

    return {
      videoId,
      databaseId: video.id,
      chunksProcessed: chunks.length,
      alreadyProcessed: false,
      processingStatus: VideoProcessingStatus.COMPLETED,
    };
  } catch (error: unknown) {
    await updateVideoProcessingStatus(video.id, VideoProcessingStatus.FAILED);

    throw error;
  }
}
