/* 
Create ingestion service
Now we combine: Transcript + Chunking + Embeddings + Database
*/

import { getTranscript } from '../youtube/youtube.service.js';
import { createChunks } from './chunk.service.js';
import { generateEmbedding } from '../embeddings/embedding.service.js';

import { VideoProcessingStatus } from '../../types/video.type.js';

import {
  createVideo,
  claimVideoForProcessing,
  updateVideoProcessingStatus,
  findVideoByYouTubeId,
  updateVideoProcessingStatusWithClient,
} from '../../repositories/video.repository.js';
import { createChunkWithClient } from '../../repositories/chunk.repository.js';
import { withTransaction } from '../../db/transaction.js';
import { AppError, ErrorCode } from '../../shared/errors/index.js';
import { TextChunk } from '../../types/chunk.type.js';
import { config } from '../../shared/config/index.js';

interface ChunkWithEmbedding {
  chunk: ReturnType<typeof createChunks>[number];
  embedding: number[];
  chunkIndex: number;
}

export async function ingestVideo(url: string) {
  /*
   * ---------------------------------------------------------
   * PHASE 1
   * Get the transcript.
   *
   * This happens before the database transaction because
   * YouTube is an external service and may take time.
   * ---------------------------------------------------------
   */
  const { videoId, transcript } = await getTranscript(url);

  /*
   * ---------------------------------------------------------
   * PHASE 2
   * Atomically create the video if it doesn't exist.
   * ---------------------------------------------------------
   */
  const { video, created } = await createVideo(videoId, url, VideoProcessingStatus.PENDING);

  /*
   * Existing completed video.
   */
  if (!created && video.processingStatus === VideoProcessingStatus.COMPLETED) {
    return {
      videoId,
      databaseId: video.id,
      alreadyProcessed: true,
      processingStatus: video.processingStatus,
    };
  }

  /*
   * Existing video is currently being processed.
   */
  if (!created && video.processingStatus === VideoProcessingStatus.PROCESSING) {
    throw new AppError(
      'This video is already being processed.',
      ErrorCode.VIDEO_ALREADY_EXISTS,
      409,
      {
        videoId,
        databaseId: video.id,
        processingStatus: video.processingStatus,
      },
    );
  }

  /*
   * ---------------------------------------------------------
   * PHASE 3
   * Claim the video.
   *
   * Only one request should be able to move the video into
   * PROCESSING.
   * ---------------------------------------------------------
   */
  const processingVideo = await claimVideoForProcessing(video.id);

  if (!processingVideo) {
    const latestVideo = await findVideoByYouTubeId(videoId);

    if (latestVideo?.processingStatus === VideoProcessingStatus.PROCESSING) {
      throw new AppError(
        'This video is already being processed.',
        ErrorCode.VIDEO_PROCESSING,
        409,
        {
          videoId,
          databaseId: video.id,
        },
      );
    }

    throw new AppError(
      'Video could not be claimed for processing.',
      ErrorCode.VIDEO_PROCESSING_FAILED,
      409,
    );
  }

  try {
    /*
     * -------------------------------------------------------
     * PHASE 4
     * Create chunks.
     * -------------------------------------------------------
     */
    const chunks: TextChunk[] = createChunks(
      transcript,
      config.rag.chunkSize,
      config.rag.chunkOverlap,
    );

    /*
     * -------------------------------------------------------
     * PHASE 5
     * Generate ALL embeddings BEFORE opening the database
     * transaction.
     *
     * This is important:
     *
     * We don't want an open DB transaction while Ollama
     * performs potentially slow inference.
     * -------------------------------------------------------
     */
    const chunksWithEmbeddings: ChunkWithEmbedding[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      const embedding = await generateEmbedding(chunk.content);

      chunksWithEmbeddings.push({
        chunk,
        embedding,
        chunkIndex: i,
      });
    }

    /*
     * -------------------------------------------------------
     * PHASE 6
     * Atomic database commit.
     *
     * Either: ALL chunks + COMPLETED
     * or: NOTHING is committed.
     * -------------------------------------------------------
     */
    await withTransaction(async (client) => {
      for (const item of chunksWithEmbeddings) {
        await createChunkWithClient(client, {
          videoId: processingVideo.id,
          chunkIndex: item.chunkIndex,
          content: item.chunk.content,
          embedding: item.embedding,
          startTimeSeconds: item.chunk.startTime,
          endTimeSeconds: item.chunk.endTime,
        });
      }

      await updateVideoProcessingStatusWithClient(
        client,
        processingVideo.id,
        VideoProcessingStatus.COMPLETED,
      );
    });

    return {
      videoId,
      databaseId: processingVideo.id,
      chunksProcessed: chunksWithEmbeddings.length,
      alreadyProcessed: false,
      processingStatus: VideoProcessingStatus.COMPLETED,
    };
  } catch (error: unknown) {
    /*
     * If anything fails during embedding generation or
     * database ingestion, mark the video as FAILED.
     *
     * This status update is intentionally outside the
     * transaction because the transaction may already
     * have rolled back.
     */
    await updateVideoProcessingStatus(processingVideo.id, VideoProcessingStatus.FAILED);

    throw error;
  }
}
