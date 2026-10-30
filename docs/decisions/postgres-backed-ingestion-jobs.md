# Decision: PostgreSQL-Backed Ingestion Jobs with Fenced Leases

**Status:** Accepted for the local-first single-user lifecycle.

## Problem

Ingestion performs a transcript call and chunking. Running all of it inside `POST /process` ties API latency and request lifetime to external latency. A Node process crash can also leave the source permanently marked processing. Duplicate URLs and concurrent retries must not create multiple visible indexes.

## Naive approach

Keep the request synchronous, or push work into an in-memory promise after returning success. A process-local queue loses work on restart and cannot coordinate two API instances. A boolean `PROCESSING` flag without owner or expiry cannot distinguish an active worker from a crashed one. Blind retries can let a stale worker overwrite newer results.

## Chosen approach

- Store one `ingestion_jobs` row per source in PostgreSQL; create it in the same transaction as the source.
- Poll and claim jobs with a short `SELECT ... FOR UPDATE SKIP LOCKED` transaction.
- Every claim gets a random UUID lease token, owner, expiry, and incremented attempt count.
- A heartbeat renews the lease during transcript/chunking work. After expiry, another worker may reclaim it.
- Every phase update, failure, and completion is conditional on the current token and processing state.
- Prepare text chunks outside write transactions, then publish by replacing chunks and setting source/job terminal state in one transaction. PostgreSQL maintains the GIN index with those writes.
- Retry the same failed source/job explicitly; rely on unique source identity and retry-state locks to make repeated submissions converge.

## Why this fits VidScribe now

PostgreSQL is already required for source metadata and the transcript index. Keeping the queue there avoids a second system and lets the source/job insert be atomic. Row locking works across processes and is understandable at current volume. The frontend can refresh state from the same durable rows.

## Example and concurrency scenario

Worker A claims source 42 with token `A` and stalls during transcript retrieval. Its lease expires. Worker B claims the same row with token `B`. When A resumes, it may finish its transcript request and chunking, but its final `WHERE lease_token = 'A'` check fails. B is the only worker allowed to publish. The transaction deletes prior chunks, writes the complete new set, updates GIN entries, and marks the source ready together.

## Failure scenario

If PostgreSQL is unavailable while a worker is updating progress, the operation fails. The job remains processing until its last lease expires; another worker can claim it. If final chunk insertion fails, the transaction rolls back both deletion/insertion and READY status. A failure-update error is logged; lease recovery remains available.

## Trade-offs

- Jobs are processed at least once: crashes may repeat transcript retrieval and chunking.
- Lease renewal and token fencing add state and must use consistent locking.
- Polling adds database reads and some idle wakeups.
- Worker loops share CPU/memory with the API process and are not independently scalable yet.
- User-triggered retry is implemented; automatic exponential backoff, a DLQ, queue priorities, and broker delivery semantics are not.

## Alternatives

- **Synchronous request:** simpler, but unbounded provider latency consumes request capacity and browser disconnects complicate status.
- **In-memory queue:** cheap but loses queued work on process exit and cannot coordinate multiple instances.
- **RabbitMQ:** stronger broker features and separate scaling, at the cost of broker operations and a consistency boundary between source DB commit and message publication. Adopt after measured demand.
- **Outbox + broker:** useful once a broker is selected; not needed while the database row is itself the queue.

## Interview explanation

"I use PostgreSQL as the durable queue because it is already the system of record and can atomically store a source and its job. `SKIP LOCKED` distributes work across workers, an expiring lease recovers crashed claims, and a per-claim token fences stale workers. Processing is at least once, so transcript work may repeat, but final publication and full-text index maintenance are transactional and idempotent. I would move to RabbitMQ only when throughput or independent worker scaling justifies its operational and consistency costs."
