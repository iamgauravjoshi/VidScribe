export interface TextChunk {
  content: string;
  startTime: number;
  endTime: number;
}

export interface RetrievedChunk {
  chunkId: number;
  videoId: number;
  chunkIndex: number;
  content: string;
  startTimeSeconds: number | null;
  endTimeSeconds: number | null;
  similarity: number;
  source: {
    youtubeVideoId: string;
    title: string | null;
    url: string;
  };
}

export interface RetrievedChunkRow {
  id: number;
  video_id: number;
  chunk_index: number;
  content: string;
  start_time_seconds: number | null;
  end_time_seconds: number | null;

  youtube_video_id: string;
  title: string | null;
  url: string;

  similarity: number;
}
