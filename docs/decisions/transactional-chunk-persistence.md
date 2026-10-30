# Decision: Publish Source Chunks and `READY` Atomically

**Status:** Accepted for source index publication.

## Problem

Retrieval must not treat a source as ready while its searchable chunk index is partial. Reprocessing must replace prior indexed rows without exposing a mixed old/new index.

## Naive approach and failure mode

Delete old chunks, insert new chunks through independent pool queries, then mark the source ready. A failure midway can leave a partial index. If the worker publishes status before all rows exist, chat can return incomplete evidence. A crash can also leave old chunks mixed with a retry's new chunks.

## Chosen approach

After fetching captions and chunking outside the transaction, `completeIngestionJob` checks and locks the current job lease, deletes all prior chunks for the source, inserts the complete replacement set using the same `PoolClient`, transitions the source from `PROCESSING` to `READY`, and marks the job `COMPLETED`. PostgreSQL maintains the GIN full-text index with the chunk inserts. All of these writes and index changes commit or roll back together. Historical embeddings remain nullable compatibility data and are not part of the current search path.

## Example and failure behavior

If chunk 12 fails to insert, PostgreSQL rolls back the delete and first 11 inserts; the old committed chunk set remains intact and source status is not ready for the new attempt. If the process loses the commit acknowledgement after PostgreSQL committed, a subsequent failure update cannot match the completed job's old lease token and cannot incorrectly change it back to failed.

## Concurrency

The row lock and lease token ensure only the current job owner can publish. A stale worker either finds the token changed or observes the job completed and cannot touch the committed index. Readers see the previous committed rows until transaction commit, then the entire new index.

## Trade-offs and alternatives

Atomic replacement holds one transaction while inserting the complete chunk set. This is appropriate for current transcript sizes. A future large-document path may use a staging generation and an atomic pointer/swap, but should retain the same “only a complete generation is visible” invariant. Do not weaken publication into arbitrary partial batches.

## Interview explanation

“The source's searchable chunks and `READY` status represent one logical result. I replace chunks and transition the job/source using one PostgreSQL client and one transaction. Failure rolls the entire publication back; readers see either the prior committed state or the full replacement, never a partial ready index.”
