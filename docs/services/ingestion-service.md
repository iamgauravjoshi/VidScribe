# Ingestion Worker and Service

**Implementation:** `backend/src/services/ingestion/worker.service.ts`, `backend/src/services/ingestion/ingestion.service.ts`, and `backend/src/repositories/ingestion-job.repository.ts`.

## Purpose

Process an accepted source asynchronously and publish its searchable transcript without keeping the HTTP request open. PostgreSQL stores the job and source state so work can survive browser navigation and recover after a process crash.

## Responsibilities

- Claim queued or expired jobs with a lease token and worker identity.
- Fetch and validate English transcript segments, chunk them with timestamps/overlap, and prepare text-only index rows.
- Renew the lease while work is active and stop publication if ownership is lost.
- Replace the source's chunks and transition source/job to ready/completed atomically. PostgreSQL maintains the GIN search index in this transaction.
- Record a safe failure state when the current lease still owns the job.

It does not own HTTP serialization, YouTube identity parsing, SQL details, answer generation, or conversation persistence. No external model is needed to index a transcript.

## Execution flow

1. `claimNextIngestionJob` selects an eligible row with `FOR UPDATE SKIP LOCKED`, increments the attempt, and assigns a random lease token/expiry.
2. The worker moves the source/job to `PROCESSING` / `FETCHING_TRANSCRIPT` and starts a heartbeat at roughly one third of the lease duration.
3. The service fetches English captions and rejects an empty transcript.
4. It stores the `CHUNKING` phase and creates timestamped overlapping chunks.
5. It stores `INDEXING`, verifies lease ownership, and prepares chunk persistence inputs without calling Ollama or Gemini.
6. It stores `PERSISTING` and calls `completeIngestionJob`.
7. The repository locks and verifies the current job token, deletes the prior chunks, inserts the complete text chunk set, and marks the source ready/job complete in one transaction. The expression GIN index changes transactionally with the inserts.
8. A stale worker cannot publish or record a failure after another worker owns the lease.

## Error handling

Missing/empty captions are marked non-retryable in the current flow. Transient transcript and database/index-write failures are retryable. Worker crashes are recovered by lease expiry; repeated expired claims are bounded by `max_attempts`. If failure persistence fails, the job remains processing until lease expiry. A failure in the publication transaction rolls back chunk deletion, all new rows, GIN index changes, and the ready-state transition together.

## Concurrency and idempotency

`SKIP LOCKED` distributes independent jobs. Lease tokens fence stale results. Reprocessing a source uses a replace-all write under a unique `(source_id, chunk_index)` constraint, so retries do not accumulate chunks. Transcript calls and chunking are at-least-once after crashes, but there is no model embedding cost to repeat. A single publication transaction ensures readers never see a partial reindex.

## Database and external calls

Claims, phase changes, retries, failures, and final publication use short transactions. Transcript retrieval and chunking run outside the write transaction. The only external call is the YouTube transcript adapter, which currently has no abort-signal timeout. PostgreSQL is the durable queue and full-text index.

## Testing strategy

The isolated PostgreSQL integration test covers competing claims, expired-lease reclaim, stale-token fencing, retry idempotency, rollback, publication with `embedding = NULL`, full-text search, and source scoping. Also test transcript empty/fetch failures and worker lease loss. Never use the development database for integration tests.

## Future evolution

Keep PostgreSQL as the queue while source/job creation and chunk publication remain transactional in one database. Add transcript cancellation, bounded worker concurrency, backoff, metrics, and correlation before throughput grows. If a semantic retrieval option returns, it should be an explicit index strategy and must not change transcript transfer behavior without user choice.

See [the job/lease decision](../decisions/postgres-backed-ingestion-jobs.md), [local FTS decision](../decisions/local-postgres-full-text-retrieval.md), and [atomic chunk publication](../decisions/transactional-chunk-persistence.md).
