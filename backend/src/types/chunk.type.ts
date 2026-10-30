export interface TextChunk {
  content: string;
  startTime: number;
  endTime: number;
}

export interface RetrievedChunkRow {
  id: number;
  source_id: number;
  chunk_index: number;
  content: string;
  start_seconds: number | null;
  end_seconds: number | null;
  external_id: string;
  canonical_url: string;
  title: string | null;
  relevanceScore: number;
}
