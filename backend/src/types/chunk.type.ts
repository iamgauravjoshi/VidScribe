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
  phrase_match: boolean;
  full_query_match: boolean;
  citation_segment_index: number | null;
  citation_start_seconds: number | null;
  citation_end_seconds: number | null;
  citation_excerpt: string | null;
  citation_phrase_match: boolean | null;
  citation_full_query_match: boolean | null;
  citation_relevance_score: number | null;
}
