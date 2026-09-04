import { pool } from '../db/postgres.js';
import type { VideoProcessingStatus } from '../types/video.type.js';

export interface VideoRecord {
  id: number;
  youtubeVideoId: string;
  url: string;
  title: string | null;
  processingStatus: VideoProcessingStatus;
  createdAt: Date;
}

export async function findVideoByYouTubeId(videoId: string): Promise<VideoRecord | null> {
  const result = await pool.query<VideoRecord>(
    `
    SELECT
      id,
      youtube_video_id,
      url,
      title,
      processing_status,
      created_at
    FROM videos
    WHERE youtube_video_id = $1
    LIMIT 1
    `,
    [videoId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    id: row.id,
    youtubeVideoId: row.youtubeVideoId,
    url: row.url,
    title: row.title,
    processingStatus: row.processingStatus,
    createdAt: row.createdAt,
  };
}

export async function findVideoById(id: number): Promise<VideoRecord | null> {
  const result = await pool.query<VideoRecord>(
    `
    SELECT
      id,
      youtube_video_id,
      url,
      title,
      processing_status,
      created_at
    FROM videos
    WHERE id = $1
    `,
    [id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    id: row.id,
    youtubeVideoId: row.youtubeVideoId,
    url: row.url,
    title: row.title,
    processingStatus: row.processingStatus,
    createdAt: row.createdAt,
  };
}

export async function createVideo(
  videoId: string,
  url: string,
  processingStatus: VideoProcessingStatus,
): Promise<VideoRecord> {
  const result = await pool.query<VideoRecord>(
    `
      INSERT INTO videos (
        youtube_video_id,
        url,
        processing_status
      )
      VALUES ($1, $2)
      RETURNING
        id,
        youtube_video_id,
        url,
        title,
        processing_status,
        created_at
    `,
    [videoId, url, processingStatus],
  );

  const row = result.rows[0];

  return {
    id: row.id,
    youtubeVideoId: row.youtubeVideoId,
    url: row.url,
    title: row.title,
    processingStatus: row.processingStatus,
    createdAt: row.createdAt,
  };
}

export async function updateVideoProcessingStatus(
  videoId: number,
  status: VideoProcessingStatus,
): Promise<void> {
  await pool.query(
    `
    UPDATE videos
    SET processing_status = $1
    WHERE id = $2
    `,
    [status, videoId],
  );
}
