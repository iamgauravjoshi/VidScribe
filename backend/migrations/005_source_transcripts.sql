ALTER TABLE public.ingestion_jobs
  ADD COLUMN operation TEXT NOT NULL DEFAULT 'INGEST_SOURCE';

ALTER TABLE public.ingestion_jobs
  ADD CONSTRAINT ingestion_jobs_operation_check
  CHECK (operation IN ('INGEST_SOURCE', 'TRANSCRIPT_REFRESH'));

CREATE TABLE public.source_transcripts (
  source_id BIGINT PRIMARY KEY
    REFERENCES public.sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'READY', 'FAILED')),
  language_code TEXT,
  retrieval_method TEXT NOT NULL DEFAULT 'youtube_captions'
    CHECK (retrieval_method = 'youtube_captions'),
  segment_count INTEGER NOT NULL DEFAULT 0 CHECK (segment_count >= 0),
  fetched_at TIMESTAMPTZ,
  failure_code TEXT,
  failure_message TEXT,
  failure_retryable BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT source_transcripts_ready_metadata_check
    CHECK (
      status <> 'READY'
      OR (language_code IS NOT NULL AND segment_count > 0 AND fetched_at IS NOT NULL)
    ),
  CONSTRAINT source_transcripts_failed_message_check
    CHECK (status <> 'FAILED' OR failure_message IS NOT NULL)
);

CREATE TABLE public.source_transcript_segments (
  source_id BIGINT NOT NULL
    REFERENCES public.source_transcripts(source_id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL CHECK (segment_index >= 0),
  start_seconds DOUBLE PRECISION NOT NULL
    CHECK (start_seconds >= 0 AND start_seconds < 'Infinity'::DOUBLE PRECISION),
  duration_seconds DOUBLE PRECISION NOT NULL
    CHECK (duration_seconds >= 0 AND duration_seconds < 'Infinity'::DOUBLE PRECISION),
  text TEXT NOT NULL CHECK (BTRIM(text) <> ''),
  PRIMARY KEY (source_id, segment_index)
);

CREATE INDEX source_transcript_segments_time_idx
  ON public.source_transcript_segments (source_id, start_seconds, segment_index);

CREATE INDEX source_transcript_segments_english_gin_idx
  ON public.source_transcript_segments
  USING GIN (TO_TSVECTOR('english', text));
