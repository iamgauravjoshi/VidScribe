# Persisted Conversations and Idempotent Answer Turns

**Status:** Implemented and verified against the isolated PostgreSQL test database.  
**Date:** 2026-10-29

## Problem

The source workspace previously kept chat messages only in React component state. Reloading or navigating away erased questions, answers, and citations. Retrying a request after a timeout could append a duplicate user message, and a lost response left the client unable to tell whether the server had already completed the answer.

VidScribe needs one durable conversation per source in the first release, with saved citations and an honest representation of pending and failed model work.

## Naive approach

Insert the user's message, call the selected answer provider, then insert the assistant answer. On failure, show a toast and let the user submit the question again.

## Why the naive approach is problematic

- A process crash between the two inserts leaves an unanswered user message with no durable processing state.
- A timeout after the answer insert but before the HTTP response can cause a retry to insert duplicate question/answer rows and call the selected answer provider again.
- Concurrent requests from two tabs can both observe that a turn is new.
- Holding a transaction open during retrieval and LLM inference consumes a database connection and locks for work that can be slow or failure-prone.
- Citations can become detached from the answer or accidentally be replaced by a later retry.

## Chosen approach

- Create one `conversations` row per source. Create it in the source/job transaction for new sources and seed it for existing sources during migration.
- Persist messages in `messages` with a `turn_id` UUID, role, status, answer/citation data, safe failure information, attempt count, generation token, and lease expiry.
- Require the browser to generate one UUID for each submitted question and reuse it for retries.
- In a short transaction, lock the conversation row, reject key/question mismatch, and create the user message plus pending assistant placeholder exactly once.
- Release the transaction before RAG inference. Renew a lease during work, then use a token-fenced transaction to persist the completed answer/citations or a safe failure.
- Return a stored completed answer on replay, return pending while another valid lease exists, or reclaim an expired/retryable turn with a new token.
- Load conversation DTOs from the API on workspace open and keep pending states current with polling.

## Why we chose it

It preserves the current synchronous RAG API while making the durable outcome recoverable. PostgreSQL is already the system of record, so the same store can enforce uniqueness and serialize claims without introducing a second queue. The short transaction boundaries keep inference out of database locks. The fencing token prevents a slow request from publishing after another request has reclaimed the turn.

The schema intentionally supports one conversation per source today. Named conversations, ownership, and chat-worker queueing would add product and operational behavior not yet required.

## Example

The browser submits question “What is the main idea?” using UUID `T`. The API commits one user row and one pending assistant row for `T`, then retrieves local PostgreSQL full-text matches and calls the selected answer provider. If the first HTTP response is lost after the answer is committed, the browser retries question plus UUID `T`. The repository sees the completed assistant row and returns its saved answer and citations; no second model call or message pair is created.

## Failure scenario

If PostgreSQL retrieval or the selected answer provider fails, the assistant row becomes `FAILED` with a safe error message and retryability flag, while the user row remains. A retry with `T` reclaims that same assistant row and increments its attempt count. If the API crashes after creating the pending rows but before recording an answer, the lease expires; the user can resume `T`. If inference succeeded but the completion transaction failed, inference may run again after expiry, but only the current token can publish the durable answer.

## Concurrency scenario

Two identical POSTs with UUID `T` arrive together. The first locks the conversation and inserts the pair. The second waits for that short transaction, then sees the existing pending assistant row with a live lease and returns 202. If a request comes after expiry, it updates the same assistant row with a new token. The original request's completion update affects zero rows because its token is stale. Completion/failure locks the conversation before the assistant row, matching source deletion's parent-to-child cascade order and avoiding a deadlock from inverted locks.

Different UUIDs can still execute concurrently. The current browser prevents another send while a turn is pending, but that is usability control rather than a server throughput limit. Add model concurrency control if the application later supports many simultaneous users.

## Trade-offs

**Gains:** durable history; idempotent client retry; source-scoped citations; explicit pending/failed states; safe stale-writer fencing; atomic user/assistant creation and answer/citation publication.

**Costs:** more schema and state logic; polling for pending turns; a lease duration/heartbeat to tune; at-least-once inference after uncertain failures; synchronous HTTP latency remains; one conversation per source is a deliberate current limitation.

## Alternatives considered

### Frontend local storage

Would preserve one browser's messages through refresh, but would not be shared across devices/tabs reliably, would not coordinate concurrent requests, and would not survive browser data clearing. Rejected as the source of truth.

### Insert messages only after inference

Avoids pending state but loses the question if the process crashes during model work. It also cannot expose or reclaim an in-flight turn. Rejected.

### Keep a database transaction open during inference

Would hold a row lock and connection over slow network/model calls, increasing contention and exhausting the pool under concurrency. Rejected.

### Queue all answers to a background worker now

Could close the HTTP request quickly and recover abandoned work automatically, but would introduce another worker lifecycle and user-visible asynchronous contract before validating this first local flow. The message/lease model leaves a clear upgrade path. Deferred until wait time or recovery requirements justify it.

### Use a broker for answer jobs

Would support independent delivery/scaling, but creates a consistency boundary between the message transaction and broker publication. PostgreSQL is sufficient for the current local scale. Deferred until measured volume justifies the operational cost.

## Interview explanation

### Interview question

Why persist a pending assistant message and use a request ID instead of saving the chat only after the answer completes?

### Short answer

The pending row makes the user's turn recoverable before slow model work starts, and the request UUID makes retries refer to that same logical turn. A short transaction creates the user/assistant pair, inference runs without a database transaction, and a fencing token ensures only the current lease owner can save the answer and citations. This gives one durable result per turn even though the external model call may run more than once after a failure.

### Deep answer

The request ID is an idempotency key scoped to a source conversation. A database unique constraint guarantees only one row per role and turn ID, while `SELECT ... FOR UPDATE` on the conversation serializes claim decisions. The API stores the user question and a pending assistant state before calling RAG. A lease expiry supports recovery, and a random generation token fences the old request if another request reclaims the turn. Completion writes answer, citations, and provider/model provenance atomically. We do not claim exactly-once inference because an external model provider and PostgreSQL cannot share a transaction; we make the durable result single-writer and retry-safe.

### Real-world example

A client times out after the server committed the answer but before receiving the response. It repeats the same UUID. The API reads the completed row and returns the stored answer instead of calling the model again.

### Follow-up questions

- **What if the client reuses the key for a different question?** The service rejects it with `IDEMPOTENCY_KEY_REUSED` so an old key cannot silently refer to new content.
- **What if the first model request is still running after its lease expires?** A retry may reclaim the same message; the old generation token cannot publish after the new claim.
- **Is model execution exactly once?** No. It is at-least-once across crash/commit uncertainty. The durable message pair and current-owner publication are idempotent.
- **Why not use RabbitMQ?** PostgreSQL already owns the source/conversation data and current volume is local. A broker adds a dual-write/outbox problem and should follow a measured need for independent scaling.
- **What is the next reliability step?** Execute the migration and concurrency scenarios against PostgreSQL, then decide whether observed model latency justifies a durable answer worker.
