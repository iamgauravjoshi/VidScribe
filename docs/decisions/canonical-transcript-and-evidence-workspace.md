# Canonical Transcript and Source Evidence Workspace

**Status:** Accepted for the single-user local-first product, 2026-11-03.

## Problem

The first ingestion design fetched timestamped caption segments, converted them into overlapping retrieval chunks, and persisted only the chunks. That supports Q&A but discards the original segment boundaries needed for a transcript reader, accurate exports, transcript search, and timestamp-to-player navigation.

## Naive approach

Rebuild the transcript screen from the saved `source_chunks` table and use its text for TXT/SRT/VTT downloads.

## Why that is problematic

Chunks deliberately overlap to improve retrieval context. Combining them duplicates text, while de-duplicating by comparing strings or timestamp ranges is heuristic and can erase repeated phrases or distort timing. Chunk boundaries are an implementation detail of retrieval, not a faithful representation of the source transcript.

Another naive upgrade would reconstruct transcript segments from every existing chunk, or silently fetch captions for every old source during migration. The first fabricates data; the second makes a schema migration trigger unrequested network activity and may overload the transcript provider.

## Chosen approach

- Store current normalized source segments in `source_transcript_segments`, with a `source_transcripts` metadata row for status, language, retrieval method, count, fetch time, and refresh failure.
- Keep `source_chunks` as a separate derived retrieval representation.
- In one fenced PostgreSQL transaction, replace transcript segments and chunks, update metadata, and mark a newly ingested source ready/job complete.
- For older ready sources without transcript rows, offer a user-triggered `TRANSCRIPT_REFRESH` operation on the existing PostgreSQL job. It leaves source status and old chunks ready until the replacement is committed. Failure affects transcript-refresh state only.
- Provide bounded transcript paging, source-scoped PostgreSQL search, context lookup around a timestamp, and TXT/SRT/VTT export.
- Load the YouTube embed after explicit user action or citation navigation, preserve an external link fallback, and keep transcript/index data local.

## Why this approach

It gives the transcript a durable and faithful representation without changing the meaning of chunks or introducing another queue. A single transaction guarantees that a newly ready source has both readable transcript data and a searchable index. A refresh failure does not break a legacy source's prior Q&A. Bounded reads avoid sending a whole long transcript to the browser for ordinary browsing.

## Example

A user opens a new source. The worker fetches 1,200 caption segments, derives 85 overlapping chunks, and stores segments, transcript metadata, chunks, and `READY` in one transaction. A cited moment at 18:42 loads the nearest transcript page, highlights its segment, and seeks the player to that timestamp. The user can still open the YouTube link if the embed is unavailable.

An older ready source has chunks only. Selecting `Prepare transcript` queues a refresh while chat still queries its existing chunks. On success, one transaction replaces both representations. If YouTube is temporarily unavailable, transcript state becomes retryable-failed and chat remains usable against the old index.

## Failure scenario

If insertion of the 900th segment fails, the publication transaction rolls back segment deletion/insertion, metadata update, chunk replacement, and source-ready changes together. No half-transcript or half-index becomes visible. During a legacy refresh, the same rollback leaves the old chunk set committed; the transcript row records the safe refresh failure after the publication attempt is fenced out.

## Concurrency scenario

Two tabs can request an old source's transcript refresh at once. The first locks the existing job row and queues it. The second waits for that lock and returns the current operation instead of resetting its lease. A worker claim has a lease token. If it expires and another worker claims the job, the stale worker cannot commit segments or chunks. Source deletion and refresh both lock job before source, avoiding an inconsistent lock order.

## Trade-offs

- Adds transcript tables and a GIN index, which increases local database size.
- Every new transcript publication writes both canonical segments and derived chunks.
- Exports format the full transcript in backend memory; streaming is deferred until measured size needs it.
- Search is lexical English full-text search; it does not understand paraphrases or non-English stemming.
- The official embedded player contacts YouTube after the user asks to load it. If embedding fails, playback/citation fallback opens YouTube externally.
- Historical transcript rows are not fabricated. Existing ready sources require one explicit refresh before transcript reading/export is available.

## Alternatives

- **Store only chunks:** simplest schema, but incorrect for a source transcript and exports.
- **Store a single JSONB transcript document:** fewer rows and one payload fetch, but weaker constraints, awkward pagination/search, and a larger update unit. Reconsider only for a measured document-oriented need.
- **Automatic re-ingestion of all sources during migration:** transparent UI after rollout, but performs unrequested external work and can make upgrade time depend on caption retrieval. Rejected.
- **Introduce a separate refresh queue/table:** isolates transcript refresh lifecycle but duplicates job claiming/recovery. The existing PostgreSQL job can safely express the second operation while source readiness remains independent.
- **Initialize shadcn/Radix for this feature:** would add a second component system to a token-based CSS frontend without providing a needed primitive. Reuse the existing design tokens and focused React components for now.

## Interview explanation

### Interview question

Why persist transcript segments separately from retrieval chunks?

### Short answer

Chunks are overlapping search units, so they are not a faithful transcript. I persist original timestamped segments as canonical source data and derive chunks separately. Both publish in one transaction, keeping transcript reading, exports, and Q&A consistent.

### Deeper answer

The source artifact and its retrieval index have different invariants. Transcript segments preserve original ordering and timing; chunks optimize context recall and intentionally duplicate boundary content. A `READY` publication writes metadata, all segments, all chunks, and the job/source state atomically. For older rows, an explicit refresh avoids fabricating segments or causing silent network work. It keeps the old ready index available until a replacement commits and records failures separately.

### Follow-up questions

- **Why not store segments as JSONB?** Bounded ordered reads, full-text search, timestamp lookup, row-level constraints, and future pagination are central to this UX, so rows fit the access pattern.
- **What if a transcript refresh fails halfway?** The publication transaction rolls back; a legacy source keeps the previous chunk index, and the transcript state carries the refresh failure.
- **Is this exactly-once processing?** No. Caption retrieval can run at least once after a lease expires. Lease fencing and replace-all publication make database results single-writer and retry-safe.
- **Why not re-fetch old sources during migration?** A database schema migration should not unexpectedly trigger external traffic or wait on every source. The user explicitly opts into refresh.
