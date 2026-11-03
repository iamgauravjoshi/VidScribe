# Ingestion Worker and Service

**Implementation:** `backend/src/services/ingestion/worker.service.ts`, `backend/src/services/ingestion/ingestion.service.ts`, and `backend/src/repositories/ingestion-job.repository.ts`.

## Purpose

Process an accepted source asynchronously and publish its searchable transcript without keeping the HTTP request open. PostgreSQL stores the job and source state so work can survive browser navigation and recover after a process crash.

## Responsibilities

- Claim queued or expired jobs with a lease token and worker identity.
- Fetch and validate English transcript segments, retain them as canonical source data, chunk them with timestamps/overlap, and prepare text-only index rows.
- Renew the lease while work is active and stop publication if ownership is lost.
- Replace the source's transcript segments and chunks, persist transcript provenance, and transition source/job to ready/completed atomically. PostgreSQL maintains both GIN indexes in this transaction.
- Run a `TRANSCRIPT_REFRESH` job for older ready sources without taking their current Q&A offline.
- Record a safe failure state when the current lease still owns the job.

It does not own HTTP serialization, YouTube identity parsing, SQL details, answer generation, or conversation persistence. No external model is needed to index a transcript.

## Execution flow

1. `claimNextIngestionJob` selects an eligible row with `FOR UPDATE SKIP LOCKED`, increments the attempt, and assigns a random lease token/expiry.
2. The worker moves the source/job to `PROCESSING` / `FETCHING_TRANSCRIPT` and starts a heartbeat at roughly one third of the lease duration.
3. The service fetches English captions and rejects an empty transcript.
4. It stores the `CHUNKING` phase and creates timestamped overlapping chunks.
5. It stores `INDEXING`, verifies lease ownership, and prepares chunk persistence inputs without calling Ollama or Gemini.
6. It stores `PERSISTING` and calls `completeIngestionJob`.
7. The repository locks and verifies the current job token, deletes prior segments/chunks, writes transcript metadata and normalized segment rows, writes the complete text chunk set, and completes the job in one transaction. New-source ingestion also transitions the source to ready in this transaction. Both expression GIN indexes change transactionally with their inserts.
8. A stale worker cannot publish or record a failure after another worker owns the lease.

### Transcript refresh for existing ready sources

Migration 005 does not fabricate segment boundaries from overlapping chunks or silently fetch every user's old source. If a ready source has no canonical transcript row, the UI can request a refresh. The request locks the existing job before the source (the same order used by deletion), marks transcript state as processing, and queues the existing job with `operation = TRANSCRIPT_REFRESH`.

During refresh, the source remains `READY`, so saved conversations continue to use the existing committed chunk set. The worker fetches and chunks outside a transaction. Its final transaction replaces transcript segments and chunks together; readers see either the old index or the new index, never a partial replacement. If refresh fails, transcript state records the safe failure while the source status and old index remain ready. Retry is safe and reuses the same job.

## Error handling

Missing/empty captions are marked non-retryable in the current flow. Transient transcript and database/index-write failures are retryable. Worker crashes are recovered by lease expiry; repeated expired claims are bounded by `max_attempts`. If failure persistence fails, the job remains processing until lease expiry. A failure in the publication transaction rolls back segment/chunk deletion, all new rows, both GIN index changes, and the source-ready transition together. A transcript-refresh fetch or publish failure is recorded on transcript state and leaves the existing ready source and index intact.

## Concurrency and idempotency

`SKIP LOCKED` distributes independent jobs. Lease tokens fence stale results. Reprocessing a source uses replace-all writes under unique source/segment and source/chunk keys, so retries do not accumulate rows. Transcript calls and chunking are at-least-once after crashes, but there is no model embedding cost to repeat. A single publication transaction ensures readers never see a partial transcript or reindex. Refresh requests serialize on the existing job row, so concurrent clicks do not enqueue duplicate work.

## Database and external calls

Claims, phase changes, retries, failures, and final publication use short transactions. Transcript retrieval and chunking run outside the write transaction. The only external call is the YouTube transcript adapter, which currently has no abort-signal timeout. PostgreSQL is the durable queue and full-text index.

## Testing strategy

The isolated PostgreSQL integration test covers competing claims, expired-lease reclaim, stale-token fencing, retry idempotency, rollback, publication with `embedding = NULL`, full-text search, and source scoping. Transcript persistence must remain in that same transaction. Also test transcript empty/fetch failures, concurrent refresh requests, continued Q&A against the old index during refresh, refresh rollback, and worker lease loss. Never use the development database for integration tests.

## Future evolution

Keep PostgreSQL as the queue while source/job creation and chunk publication remain transactional in one database. Add transcript cancellation, bounded worker concurrency, backoff, metrics, and correlation before throughput grows. If a semantic retrieval option returns, it should be an explicit index strategy and must not change transcript transfer behavior without user choice.

See [the job/lease decision](../decisions/postgres-backed-ingestion-jobs.md), [local FTS decision](../decisions/local-postgres-full-text-retrieval.md), and [atomic chunk publication](../decisions/transactional-chunk-persistence.md).
