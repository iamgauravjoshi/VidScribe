CREATE EXTENSION IF NOT EXISTS vector;

-- Preserve the existing single-source tables and records by renaming them in
-- place. A clean database is created directly with the source-oriented schema.
DO $$
BEGIN
  IF to_regclass('public.sources') IS NULL AND to_regclass('public.videos') IS NOT NULL THEN
    ALTER TABLE public.videos RENAME TO sources;
  END IF;

  IF to_regclass('public.source_chunks') IS NULL AND to_regclass('public.video_chunks') IS NOT NULL THEN
    ALTER TABLE public.video_chunks RENAME TO source_chunks;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.sources (
  id BIGSERIAL PRIMARY KEY,
  source_type TEXT NOT NULL DEFAULT 'youtube',
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT,
  processing_status TEXT NOT NULL DEFAULT 'QUEUED',
  processing_phase TEXT,
  processing_error_code TEXT,
  processing_error_message TEXT,
  processing_retryable BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sources' AND column_name = 'youtube_video_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sources' AND column_name = 'external_id'
  ) THEN
    ALTER TABLE public.sources RENAME COLUMN youtube_video_id TO external_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sources' AND column_name = 'url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sources' AND column_name = 'canonical_url'
  ) THEN
    ALTER TABLE public.sources RENAME COLUMN url TO canonical_url;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'source_chunks' AND column_name = 'video_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'source_chunks' AND column_name = 'source_id'
  ) THEN
    ALTER TABLE public.source_chunks RENAME COLUMN video_id TO source_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'source_chunks' AND column_name = 'start_time_seconds'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'source_chunks' AND column_name = 'start_seconds'
  ) THEN
    ALTER TABLE public.source_chunks RENAME COLUMN start_time_seconds TO start_seconds;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'source_chunks' AND column_name = 'end_time_seconds'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'source_chunks' AND column_name = 'end_seconds'
  ) THEN
    ALTER TABLE public.source_chunks RENAME COLUMN end_time_seconds TO end_seconds;
  END IF;
END
$$;

ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'youtube';
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS canonical_url TEXT;
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS processing_status TEXT;
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS processing_phase TEXT;
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS processing_error_code TEXT;
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS processing_error_message TEXT;
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS processing_retryable BOOLEAN;
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.source_chunks (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  start_seconds DOUBLE PRECISION,
  end_seconds DOUBLE PRECISION,
  embedding VECTOR NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.source_chunks ADD COLUMN IF NOT EXISTS source_id BIGINT;
ALTER TABLE public.source_chunks ADD COLUMN IF NOT EXISTS chunk_index INTEGER;
ALTER TABLE public.source_chunks ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE public.source_chunks ADD COLUMN IF NOT EXISTS start_seconds DOUBLE PRECISION;
ALTER TABLE public.source_chunks ADD COLUMN IF NOT EXISTS end_seconds DOUBLE PRECISION;
ALTER TABLE public.source_chunks ADD COLUMN IF NOT EXISTS embedding VECTOR;
ALTER TABLE public.source_chunks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- A renamed legacy table keeps its old status CHECK constraint. Remove any
-- checks that reference the legacy status column before normalizing values.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.sources'::REGCLASS
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%processing_status%'
  LOOP
    EXECUTE FORMAT('ALTER TABLE public.sources DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END
$$;

UPDATE public.sources
SET external_id = COALESCE(external_id, ''),
    canonical_url = COALESCE(
      canonical_url,
      CASE WHEN COALESCE(external_id, '') <> ''
        THEN 'https://www.youtube.com/watch?v=' || external_id
        ELSE ''
      END
    );

UPDATE public.sources AS s
SET processing_status = CASE
  WHEN UPPER(COALESCE(s.processing_status, '')) IN ('READY', 'COMPLETED') THEN 'READY'
  WHEN UPPER(COALESCE(s.processing_status, '')) IN ('QUEUED', 'PENDING') THEN 'QUEUED'
  WHEN UPPER(COALESCE(s.processing_status, '')) = 'PROCESSING' THEN 'FAILED'
  WHEN UPPER(COALESCE(s.processing_status, '')) = 'FAILED' THEN 'FAILED'
  WHEN EXISTS (
    SELECT 1 FROM public.source_chunks AS c
    WHERE c.source_id = s.id AND c.embedding IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.source_chunks AS c
    WHERE c.source_id = s.id AND c.embedding IS NULL
  ) THEN 'READY'
  ELSE 'FAILED'
END,
processing_error_code = CASE
  WHEN UPPER(COALESCE(s.processing_status, '')) = 'PROCESSING' THEN 'INTERRUPTED_DURING_MIGRATION'
  WHEN UPPER(COALESCE(s.processing_status, '')) = 'FAILED' THEN COALESCE(s.processing_error_code, 'PREVIOUS_ATTEMPT_FAILED')
  WHEN UPPER(COALESCE(s.processing_status, '')) NOT IN ('READY', 'COMPLETED', 'QUEUED', 'PENDING', 'PROCESSING', 'FAILED')
    AND NOT EXISTS (
      SELECT 1 FROM public.source_chunks AS c
      WHERE c.source_id = s.id AND c.embedding IS NOT NULL
    ) THEN 'NO_INDEXED_CONTENT'
  ELSE s.processing_error_code
END,
processing_error_message = CASE
  WHEN UPPER(COALESCE(s.processing_status, '')) = 'PROCESSING'
    THEN 'An earlier in-process job was interrupted while enabling durable processing. Retry to resume.'
  WHEN UPPER(COALESCE(s.processing_status, '')) = 'FAILED'
    THEN COALESCE(s.processing_error_message, 'The previous processing attempt failed. Retry to try again.')
  WHEN UPPER(COALESCE(s.processing_status, '')) NOT IN ('READY', 'COMPLETED', 'QUEUED', 'PENDING', 'PROCESSING', 'FAILED')
    AND NOT EXISTS (
      SELECT 1 FROM public.source_chunks AS c
      WHERE c.source_id = s.id AND c.embedding IS NOT NULL
    ) THEN 'No indexed transcript chunks were found. Retry processing to build the source index.'
  ELSE s.processing_error_message
END,
processing_retryable = CASE
  WHEN UPPER(COALESCE(s.processing_status, '')) IN ('PROCESSING', 'FAILED') THEN TRUE
  WHEN UPPER(COALESCE(s.processing_status, '')) NOT IN ('READY', 'COMPLETED', 'QUEUED', 'PENDING')
    AND NOT EXISTS (
      SELECT 1 FROM public.source_chunks AS c
      WHERE c.source_id = s.id AND c.embedding IS NOT NULL
    ) THEN TRUE
  ELSE COALESCE(s.processing_retryable, FALSE)
END,
updated_at = COALESCE(s.updated_at, s.created_at, NOW());

ALTER TABLE public.sources ALTER COLUMN external_id SET NOT NULL;
ALTER TABLE public.sources ALTER COLUMN canonical_url SET NOT NULL;
ALTER TABLE public.sources ALTER COLUMN processing_status SET DEFAULT 'QUEUED';
ALTER TABLE public.sources ALTER COLUMN processing_status SET NOT NULL;
ALTER TABLE public.sources ALTER COLUMN processing_retryable SET DEFAULT FALSE;
ALTER TABLE public.sources ALTER COLUMN processing_retryable SET NOT NULL;
ALTER TABLE public.source_chunks ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE public.source_chunks ALTER COLUMN chunk_index SET NOT NULL;
ALTER TABLE public.source_chunks ALTER COLUMN content SET NOT NULL;
ALTER TABLE public.source_chunks ALTER COLUMN embedding SET NOT NULL;

UPDATE public.sources AS s
SET processing_status = 'FAILED',
    processing_error_code = 'NO_INDEXED_CONTENT',
    processing_error_message = 'No complete transcript index was found. Retry processing to build the source index.',
    processing_retryable = TRUE,
    updated_at = NOW()
WHERE s.processing_status = 'READY'
  AND (
    NOT EXISTS (SELECT 1 FROM public.source_chunks AS c WHERE c.source_id = s.id)
    OR EXISTS (
      SELECT 1 FROM public.source_chunks AS c
      WHERE c.source_id = s.id AND c.embedding IS NULL
    )
  );

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  -- Drop a legacy single-column UNIQUE(youtube_video_id) constraint so source
  -- identity can correctly be scoped by both source type and external ID.
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint AS c
    JOIN LATERAL UNNEST(c.conkey) AS key(attnum) ON TRUE
    JOIN pg_attribute AS a ON a.attrelid = c.conrelid AND a.attnum = key.attnum
    WHERE c.conrelid = 'public.sources'::REGCLASS
      AND c.contype = 'u'
    GROUP BY c.conname
    HAVING ARRAY_AGG(a.attname::TEXT ORDER BY a.attname::TEXT) = ARRAY['external_id']::TEXT[]
  LOOP
    EXECUTE FORMAT('ALTER TABLE public.sources DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  -- Also remove a hand-created unique index on external_id if the legacy
  -- schema used an index instead of a table constraint.
  FOR constraint_name IN
    SELECT index_relation.relname
    FROM pg_index AS index_definition
    JOIN pg_class AS table_relation ON table_relation.oid = index_definition.indrelid
    JOIN pg_class AS index_relation ON index_relation.oid = index_definition.indexrelid
    WHERE table_relation.oid = 'public.sources'::REGCLASS
      AND index_definition.indisunique
      AND NOT index_definition.indisprimary
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint AS c WHERE c.conindid = index_definition.indexrelid
      )
      AND (
        SELECT ARRAY_AGG(a.attname::TEXT ORDER BY a.attname::TEXT)
        FROM UNNEST(index_definition.indkey) AS key(attnum)
        JOIN pg_attribute AS a
          ON a.attrelid = index_definition.indrelid AND a.attnum = key.attnum
        WHERE key.attnum > 0
      ) = ARRAY['external_id']::TEXT[]
  LOOP
    EXECUTE FORMAT('DROP INDEX public.%I', constraint_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sources'::REGCLASS AND conname = 'sources_processing_status_check'
  ) THEN
    ALTER TABLE public.sources
      ADD CONSTRAINT sources_processing_status_check
      CHECK (processing_status IN ('QUEUED', 'PROCESSING', 'READY', 'FAILED')) NOT VALID;
  END IF;

  -- Recreate legacy references with a known name and cascade behavior. A
  -- renamed legacy FK retains its old constraint name, so validating a new
  -- expected name without normalizing it would fail on upgraded databases.
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.source_chunks'::REGCLASS
      AND contype = 'f'
      AND confrelid = 'public.sources'::REGCLASS
  LOOP
    EXECUTE FORMAT('ALTER TABLE public.source_chunks DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE public.source_chunks
    ADD CONSTRAINT source_chunks_source_id_fkey
    FOREIGN KEY (source_id) REFERENCES public.sources(id) ON DELETE CASCADE NOT VALID;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS sources_source_type_external_id_uidx
  ON public.sources (source_type, external_id);

CREATE UNIQUE INDEX IF NOT EXISTS source_chunks_source_id_chunk_index_uidx
  ON public.source_chunks (source_id, chunk_index);

ALTER TABLE public.sources VALIDATE CONSTRAINT sources_processing_status_check;
ALTER TABLE public.source_chunks VALIDATE CONSTRAINT source_chunks_source_id_fkey;

CREATE TABLE IF NOT EXISTS public.ingestion_jobs (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL UNIQUE REFERENCES public.sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  phase TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.ingestion_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE public.ingestion_jobs ADD COLUMN IF NOT EXISTS phase TEXT;

INSERT INTO public.ingestion_jobs (source_id, status, attempt_count, available_at, created_at, updated_at, completed_at)
SELECT
  s.id,
  CASE s.processing_status
    WHEN 'QUEUED' THEN 'QUEUED'
    WHEN 'PROCESSING' THEN 'QUEUED'
    WHEN 'READY' THEN 'COMPLETED'
    ELSE 'FAILED'
  END,
  CASE WHEN s.processing_status = 'READY' THEN 1 ELSE 0 END,
  NOW(),
  s.created_at,
  s.updated_at,
  CASE WHEN s.processing_status = 'READY' THEN s.updated_at ELSE NULL END
FROM public.sources AS s
ON CONFLICT (source_id) DO NOTHING;

UPDATE public.sources AS s
SET processing_status = 'QUEUED',
    processing_error_code = NULL,
    processing_error_message = NULL,
    processing_retryable = FALSE,
    updated_at = NOW()
FROM public.ingestion_jobs AS j
WHERE j.source_id = s.id
  AND j.status = 'QUEUED';

CREATE INDEX IF NOT EXISTS ingestion_jobs_claim_idx
  ON public.ingestion_jobs (available_at, created_at)
  WHERE status IN ('QUEUED', 'PROCESSING');

CREATE INDEX IF NOT EXISTS source_chunks_source_id_idx
  ON public.source_chunks (source_id);
