# Transcript Service and Source Evidence Workspace

**Implementation:** `backend/src/services/transcript/transcript.service.ts`, `backend/src/repositories/transcript.repository.ts`, `backend/src/repositories/ingestion-job.repository.ts`, `frontend/src/components/TranscriptPanel.tsx`, `frontend/src/components/YouTubePlayer.tsx`, and `frontend/src/components/ChatWindow.tsx`.

## Purpose

Keep the original timestamped transcript useful as a source artifact. Search chunks are derived retrieval data and may overlap; they are not a reliable format for a reader, timestamp navigation, or transcript export.

## Responsibilities

- Return bounded pages of normalized caption segments in chronological source order.
- Search the local English transcript with PostgreSQL full-text search.
- Return transcript context near a citation timestamp.
- Build UTF-8 TXT, SRT, and VTT downloads from saved segments.
- Coordinate a user-requested transcript refresh for older `READY` sources without taking their current Q&A offline.
- In the frontend, connect transcript/citation timestamps to an explicit, user-initiated YouTube embed and maintain a selected segment state.

It does not own source URL parsing, caption fetching, retrieval chunking, answer generation, conversation persistence, transcript editing, translations, speech recognition, or a public export storage system.

## Dependencies

- `source.service.ts` confirms that the source exists and is ready.
- `transcript.repository.ts` owns transcript metadata, segment search, paging, and export reads.
- `ingestion-job.repository.ts` queues refresh work and publishes transcript plus chunks transactionally.
- PostgreSQL owns durable transcript data and local full-text search.
- The frontend uses the YouTube IFrame Player API only after a user clicks the player action or a timestamp citation.

## Input and output

`GET /api/sources/:sourceId/transcript` accepts `limit` (1–200, default 100), an optional non-negative `cursor`, a bounded `query` (up to 200 characters), or an optional `around` timestamp. A timestamp lookup and a cursor/search query cannot be combined. The response contains transcript state and provenance, up to `limit` segments, and a continuation cursor. Segment records expose `segmentIndex`, `startSeconds`, `durationSeconds`, and text; SQL rows are not returned directly. All persisted times are seconds, normalized at the YouTube adapter boundary before chunking.

`GET /api/sources/:sourceId/transcript/export?format=txt|srt|vtt` returns a fixed source-ID filename and the matching UTF-8 media type. `POST /api/sources/:sourceId/transcript/rebuild` queues missing or retryably failed transcript data for a ready source.

## Execution flow

1. The worker fetches English caption segments and normalizes valid, non-empty text and finite timestamps.
2. The chunk service derives overlapping search chunks from those segments.
3. In `completeIngestionJob`, the repository locks and verifies the lease, replaces old segments/chunks, upserts transcript metadata, and completes the job. For initial ingestion, the source transitions to `READY` in the same transaction.
4. The workspace loads the first page from the transcript API. Search changes request a new bounded result page; `Load more` requests the next source-order page.
5. Selecting a transcript timestamp seeks the embedded player. Selecting a citation also loads a page around the nearest saved segment and highlights it.
6. The transcript export endpoint formats the saved canonical segments. It does not call an LLM or send transcript content to an answer provider.

## Legacy transcript refresh

Older ready sources have indexed chunks but no saved original segments. The migration does not reconstruct a false transcript from overlapping chunks and does not contact YouTube for every existing source automatically.

When the user selects `Prepare transcript`, the API locks the job first and the source second, marks transcript refresh state, and queues that existing job with operation `TRANSCRIPT_REFRESH`. A repeated request observes the current queued/processing operation instead of replacing its lease. The worker leaves the source status `READY`; its current chunk index remains available to chat. Final publication replaces transcript segments and chunks in one transaction. If retrieval or publication fails, the old chunk index and conversations remain available and a safe transcript-specific failure is shown.

## Error handling

- Missing source: `SOURCE_NOT_FOUND`.
- Source not ready: `SOURCE_NOT_READY`; no partial transcript is returned.
- Legacy source without transcript: `NOT_AVAILABLE` and an explicit refresh action.
- Permanent caption limitation: `FAILED` with no retry button.
- Retryable external fetch or persistence issue: `FAILED` with a safe message and explicit retry.
- Incomplete row count during export: fail the export rather than silently produce a truncated file.
- Embed blocked or YouTube API unavailable: keep transcript, Q&A, exports, and external links available.

## Concurrency and consistency

Transcript publication and chunk-index replacement are atomic. New readers see the old complete publication or the new complete publication. Refresh and source deletion lock in the same job-then-source order. Multiple refresh requests serialize on the unique source job. Job leases fence stale workers; an expired worker cannot publish after a new claim.

Search and pages are read-only. Page cursors use segment indexes, stable because a published transcript is replaced only at a single commit. Refresh failures do not mutate source readiness or the previous chunk set.

## Database interaction

- `source_transcripts` stores status, language code, retrieval method, segment count, fetch time, and safe refresh failure fields.
- `source_transcript_segments` stores original segment order, start, duration, and text, with a source/index primary key, a time lookup index, and an English GIN text-search index.
- `source_chunks` remains the separate overlapping retrieval representation and retains its existing GIN index.
- Source deletion cascades through transcript metadata and segments.

## External calls

The backend transcript API and exports are local. Ingestion contacts the existing YouTube caption adapter. The player loads the official YouTube IFrame API after explicit user action; its `seekTo` operation may seek to the nearest preceding keyframe, so the displayed timestamp is the requested caption/citation timestamp while playback can begin slightly before it. If the player fails, external timestamp links remain the fallback. [YouTube IFrame Player API reference](https://developers.google.com/youtube/iframe_api_reference)

## Testing strategy

Keep an isolated PostgreSQL integration scenario for atomic segment/chunk publication, transcript segment search, pagination, export formatting, delete cascades, and rollback. Exercise two concurrent refresh requests, source deletion racing a refresh, refresh lease loss, retry after a retryable failure, and chat retrieval against the existing chunks while a legacy refresh is processing. UI scenarios should cover page refresh, search no-results, load-more, citation seek/highlight, blocked embed fallback, each download format, and non-retryable refresh failure. Do not use the development database for integration tests.

The automated browser suite runs with `npm run test:e2e`. It starts the dedicated loopback `vidscribe_test` database and local API/UI servers, and uses the real transcript endpoints and PostgreSQL search/export behavior. The API process deliberately omits the ingestion worker so tests can set queued, failed, retrying, and ready states deterministically; database transactions in the fixture keep each simulated worker transition internally consistent. A stubbed IFrame API records `seekTo` and emits an error callback without contacting YouTube. These tests verify the browser/API contract and do not replace the PostgreSQL lifecycle tests that exercise the real worker repository and lease behavior.

### Validation record — 2026-11-03

The isolated PostgreSQL suite passed all 14 tests, including transcript publication rollback after the transcript metadata write begins, preservation of the ready source and old chunks on a failed legacy refresh, concurrent retry requests that increment the cumulative retry count only once, and successful publication after retry. The browser QA used a synthetic local source and a controlled IFrame API stub: selecting a saved citation invoked `seekTo` with the citation timestamp, centered the matching transcript segment in its scroll pane, and an injected player error showed the external YouTube fallback. TXT, SRT, and VTT downloads completed in the browser; filenames, cue/timestamp structure, and transcript text were checked. At a 390px viewport the workspace stacked into one column without horizontal overflow.

The YouTube player behavior was exercised through the IFrame API contract stub rather than a live YouTube video. The isolated app had no provider key, so its health check returned the expected degraded response and the UI displayed the provider setup notice; no provider call was made. The browser fixture was stored only in the disposable test database and removed afterward.

## Timestamp unit correction

The real-caption probe found that `youtube-transcript` 1.3.1 can return srv3 caption offsets and durations in milliseconds, even though the application contract and classic parser use seconds. New ingestion normalizes both values before chunk creation. Migration `006_normalize_youtube_transcript_times.sql` detects existing millisecond-valued segment durations using their median and repairs transcript segments, corresponding search-chunk bounds, and timestamps/URLs in saved answer citations in the same migration transaction. For older chunk-only sources with no transcript segment rows, it applies a conservative millisecond-span heuristic. Second-valued records remain unchanged.

The repository integration scenario deliberately inserts pre-fix millisecond rows and a saved citation, reruns migration 006, and checks the repaired values and an unaffected seconds-valued source. Unit coverage exercises both upstream timestamp formats. Because the legacy chunk-only heuristic cannot inspect caption durations, it is intentionally conservative; sources with no canonical segments and unusually long chunk spans should be reviewed if a future source adapter uses different chunk sizing.

### Automated browser suite — 2026-11-03

The repeatable Playwright suite passed 5/5 Chromium tests after applying migrations `001`–`005`. It verifies citation seek and visible transcript centering, player-error fallback, complete TXT/SRT/VTT downloads, full-text search returning one matching segment and a no-results state, paging from 100 to 160 rows, a 390px layout without horizontal overflow, and legacy source states from missing transcript through retryable failure/retry to ready. A second legacy case confirms a permanent failure does not offer retry. The suite starts a real Express API and Vite UI but no caption worker, YouTube API, or answer provider. Its source rows are removed after each test; the runner stops its PostgreSQL container and preserves the isolated test volume.

## Future evolution

Add transcript version history only when users need to compare caption updates or alternate transcription providers. Add more language-specific search configurations when VidScribe supports translated or non-English transcripts. Stream exports only if measured transcript sizes make full in-memory formatting material. Keep speech recognition, translation, editable transcript corrections, and transcript synchronization between remote provider versions outside this phase.
