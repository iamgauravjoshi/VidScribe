import type { PoolClient } from 'pg';
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

interface VideoRow {
  id: number;
  youtube_video_id: string;
  url: string;
  title: string | null;
  processing_status: VideoProcessingStatus;
  created_at: Date;
}

function mapVideoRow(row: VideoRow): VideoRecord {
  return {
    id: row.id,
    youtubeVideoId: row.youtube_video_id,
    url: row.url,
    title: row.title,
    processingStatus: row.processing_status,
    createdAt: row.created_at,
  };
}

export async function findVideoByYouTubeId(youtubeVideoId: string): Promise<VideoRecord | null> {
  const result = await pool.query<VideoRow>(
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
    [youtubeVideoId],
  );

  const row = result.rows[0];

  return row ? mapVideoRow(row) : null;
}

export async function findVideoById(id: number): Promise<VideoRecord | null> {
  const result = await pool.query<VideoRow>(
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
      LIMIT 1
    `,
    [id],
  );

  const row = result.rows[0];

  return row ? mapVideoRow(row) : null;
}

export async function createVideo(
  youtubeVideoId: string,
  url: string,
  status: VideoProcessingStatus,
): Promise<{
  video: VideoRecord;
  created: boolean;
}> {
  const result = await pool.query<VideoRow>(
    `
      INSERT INTO videos (
        youtube_video_id,
        url,
        processing_status
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (youtube_video_id)
      DO NOTHING
      RETURNING
        id,
        youtube_video_id,
        url,
        title,
        processing_status,
        created_at
    `,
    [youtubeVideoId, url, status],
  );

  if (result.rows.length > 0) {
    return {
      video: mapVideoRow(result.rows[0]),
      created: true,
    };
  }

  const existingVideo = await findVideoByYouTubeId(youtubeVideoId);

  if (!existingVideo) {
    throw new Error('Video could not be created or retrieved.');
  }

  return {
    video: existingVideo,
    created: false,
  };
}

/*
Processing status transitions

                  ┌────────────┐
                  │   PENDING  │
                  └─────┬──────┘
                        │
                     claim
                        │
                        ▼
                ┌──────────────┐
                │  PROCESSING  │
                └──────┬───────┘
                       │
             ┌─────────┴─────────┐
             │                   │
          success              failure
             │                   │
             ▼                   ▼
       ┌───────────┐       ┌────────┐
       │ COMPLETED │       │ FAILED │
       └───────────┘       └────────┘
                               │
                            retry
                               │
                               ▼
                          PROCESSING
                          
Suppose:
Request A → PROCESSING
Request B → PROCESSING
Request A successfully changes: PENDING → PROCESSING

Request B executes: WHERE processing_status IN ('PENDING', 'FAILED')
but now the row is: PROCESSING
Therefore:
Request B
    ↓
UPDATE affects 0 rows
    ↓
cannot claim processing

That's our concurrency protection.
*/

export async function claimVideoForProcessing(videoId: number): Promise<VideoRecord | null> {
  const result = await pool.query<VideoRow>(
    `
      UPDATE videos
      SET processing_status = $1
      WHERE id = $2
        AND processing_status IN ($3, $4)
      RETURNING
        id,
        youtube_video_id,
        url,
        title,
        processing_status,
        created_at
    `,
    ['PROCESSING', videoId, 'PENDING', 'FAILED'],
  );

  const row = result.rows[0];

  return row ? mapVideoRow(row) : null;
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

export async function updateVideoProcessingStatusWithClient(
  client: PoolClient,
  videoId: number,
  status: VideoProcessingStatus,
): Promise<void> {
  await client.query(
    `
      UPDATE videos
      SET processing_status = $1
      WHERE id = $2
    `,
    [status, videoId],
  );
}
