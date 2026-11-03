-- youtube-transcript 1.3.1 can expose srv3 timestamps in milliseconds while
-- its classic-caption parser returns seconds. Migration 006 repairs rows
-- written before normalization was added to the adapter.
CREATE TEMPORARY TABLE transcript_timestamp_millisecond_sources
ON COMMIT DROP AS
WITH segment_duration_medians AS (
  SELECT
    source_id,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_seconds) AS median_duration
  FROM public.source_transcript_segments
  WHERE duration_seconds > 0
  GROUP BY source_id
),
chunk_span_medians AS (
  SELECT
    source_id,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY end_seconds - start_seconds) AS median_span
  FROM public.source_chunks
  WHERE start_seconds IS NOT NULL
    AND end_seconds IS NOT NULL
    AND end_seconds >= start_seconds
  GROUP BY source_id
)
SELECT source_id
FROM segment_duration_medians
WHERE median_duration > 60
UNION
SELECT chunk_span_medians.source_id
FROM chunk_span_medians
WHERE chunk_span_medians.median_span > 3600
  AND NOT EXISTS (
    SELECT 1
    FROM public.source_transcript_segments
    WHERE source_transcript_segments.source_id = chunk_span_medians.source_id
  );

UPDATE public.source_transcript_segments AS segments
SET start_seconds = segments.start_seconds / 1000.0,
    duration_seconds = segments.duration_seconds / 1000.0
FROM transcript_timestamp_millisecond_sources AS candidates
WHERE segments.source_id = candidates.source_id;

UPDATE public.source_chunks AS chunks
SET start_seconds = chunks.start_seconds / 1000.0,
    end_seconds = chunks.end_seconds / 1000.0
FROM transcript_timestamp_millisecond_sources AS candidates
WHERE chunks.source_id = candidates.source_id
  AND chunks.start_seconds IS NOT NULL
  AND chunks.end_seconds IS NOT NULL;

-- Citations are persisted with assistant messages. Keep historical answers
-- aligned with the repaired source times and timestamp links as well.
UPDATE public.messages AS messages
SET citations = COALESCE(
  (
    SELECT JSONB_AGG(
      CASE
        WHEN JSONB_TYPEOF(citation.value) = 'object'
          AND JSONB_TYPEOF(citation.value -> 'startSeconds') = 'number'
        THEN citation.value || JSONB_BUILD_OBJECT(
          'startSeconds',
          (citation.value ->> 'startSeconds')::DOUBLE PRECISION / 1000.0,
          'endSeconds',
          CASE
            WHEN JSONB_TYPEOF(citation.value -> 'endSeconds') = 'number'
            THEN TO_JSONB((citation.value ->> 'endSeconds')::DOUBLE PRECISION / 1000.0)
            ELSE citation.value -> 'endSeconds'
          END,
          'href',
          'https://www.youtube.com/watch?v=' || sources.external_id || '&t=' ||
            FLOOR(((citation.value ->> 'startSeconds')::DOUBLE PRECISION / 1000.0))::BIGINT || 's'
        )
        ELSE citation.value
      END
      ORDER BY citation.ordinality
    )
    FROM JSONB_ARRAY_ELEMENTS(messages.citations) WITH ORDINALITY AS citation(value, ordinality)
  ),
  '[]'::JSONB
)
FROM public.conversations
INNER JOIN public.sources ON sources.id = conversations.source_id
INNER JOIN transcript_timestamp_millisecond_sources AS candidates
  ON candidates.source_id = sources.id
WHERE conversations.id = messages.conversation_id
  AND JSONB_TYPEOF(messages.citations) = 'array';
