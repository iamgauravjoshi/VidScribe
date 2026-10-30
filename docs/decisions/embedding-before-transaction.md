# Historical Decision: Generate Embeddings Before the Database Write Transaction

**Status:** Superseded for the current full-text ingestion path by [local PostgreSQL full-text retrieval](local-postgres-full-text-retrieval.md), 2026-10-30.

This document describes the earlier vector-index implementation. Current ingestion performs no model inference. PostgreSQL maintains the FTS index during the short atomic chunk-publication transaction; only transcript retrieval and chunking happen before it.

## Problem

Ollama inference is external and comparatively slow. VidScribe still needs to write the chunk index and publish the source's `READY` state atomically.

## Naive approach and failure mode

Open a transaction, hold a PostgreSQL client, and call Ollama for every chunk. A slow or unavailable model would keep a connection checked out and a transaction open during work PostgreSQL cannot help with. Longer transactions consume pool capacity and increase contention.

## Chosen approach

The worker fetches the transcript, chunks it, and generates embeddings before opening the final write transaction. `completeIngestionJob` then locks and verifies the job lease, replaces all chunks, updates the source to `READY`, updates the job to `COMPLETED`, and commits as one unit.

## Failure, concurrency, and trade-offs

If Ollama fails midway through embedding, no new chunk transaction has begun; the current lease records a source failure. If a chunk insert fails, the final transaction rolls back the prior-chunk deletion, inserts, and ready transition. If the worker crashes after inference, its vectors are lost from memory and the lease later expires; processing repeats. This trades repeated inference and application memory for short database transactions and atomic publication.

Two workers may perform duplicate compute only if the first lease expires while it is still working. Heartbeats reduce that window; a fencing token prevents the stale worker from publishing. Sequential calls bound pressure on local Ollama but increase job duration.

## Alternatives

- **Inference inside transaction:** simplest control flow, but poor lock and connection behavior.
- **Insert each vector immediately:** lower memory use, but partial content must be hidden or staged and retries need a publication boundary.
- **Durable staged chunks:** can resume large jobs, but requires another state model and cleanup policy. Defer until transcript size or restart cost justifies it.

## Interview explanation

“I prepare vectors before the final database transaction because inference is slow external work. The write transaction only replaces the index and publishes `READY`, so readers never see a partial completed source and database connections are not held while Ollama runs. A crash may repeat inference, but the expiring lease recovers the job and a fencing token prevents stale publication.”
