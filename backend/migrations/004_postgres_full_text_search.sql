-- Search transcripts locally with PostgreSQL. Existing vectors remain intact
-- for data compatibility, but new full-text-only chunks do not need a vector.
ALTER TABLE public.source_chunks
  ALTER COLUMN embedding DROP NOT NULL;

CREATE INDEX IF NOT EXISTS source_chunks_content_english_gin_idx
  ON public.source_chunks
  USING GIN (to_tsvector('english'::regconfig, content));

-- A worker running the previous version may have persisted EMBEDDING when this
-- migration is applied. Keep the state meaningful for the new local index flow.
UPDATE public.sources
SET processing_phase = 'INDEXING'
WHERE processing_phase = 'EMBEDDING';

UPDATE public.ingestion_jobs
SET phase = 'INDEXING'
WHERE phase = 'EMBEDDING';
