# VidScribe Interview Reference

Use these answers to explain the implemented system accurately. Separate guarantees from deferred work.

## How does VidScribe work?

**Short answer:** The browser adds a YouTube source through the Express API. PostgreSQL stores its identity and a durable ingestion job. A worker fetches English captions, chunks them with timestamps, and atomically publishes transcript text with a local PostgreSQL full-text index. A question searches that source locally, then matched evidence goes to the selected Gemini, OpenAI, Claude, or optional Ollama answer adapter and returns with timestamp citations.

**Deep answer:** The API does not perform long ingestion in the add-source request. It creates source/job state transactionally and the UI reads persisted state. PostgreSQL row locking distributes work; expiring leases recover crashes; per-claim tokens fence stale workers. Transcript retrieval and chunking happen before the final write transaction. PostgreSQL inserts all chunks, updates GIN index entries, and commits the source `READY` state together. Questions use one persisted conversation per source: the API commits a user/pending assistant pair, runs source-scoped FTS without a transaction, and persists answer/citations with a generation token.

## Why use PostgreSQL as the initial queue?

**Short answer:** PostgreSQL is already the system of record, so it can atomically store a source and its job without adding another service.

**Deep answer:** The queue is a table with a unique source relation, status, availability, attempt count, and lease fields. Workers claim using `FOR UPDATE SKIP LOCKED`, which coordinates across processes. That is enough for a local-first workload and keeps source/job creation in one transaction. Polling and shared worker/API resources are the trade-offs.

**Alternatives:** An in-memory queue loses work on restart. RabbitMQ can support independent worker scaling and richer delivery patterns, but introduces operations and a source-DB-to-broker consistency boundary. Add it only after measured demand.

## What is a lease and why have a fencing token?

**Short answer:** A lease makes a claim temporary so another worker can recover it after a crash; a token proves which claim currently owns the job.

**Example:** Worker A stalls until its lease expires. Worker B reclaims the job and receives a new token. If A later returns, its old token cannot update the phase, fail the job, or publish chunks.

**Trade-off:** A stale worker may waste an in-flight transcript request because it cannot be canceled, but it cannot commit stale data. Processing is at-least-once: caption fetching and chunking can repeat after a crash.

## Is the processing exactly once?

No. External work is at-least-once because a worker can crash after fetching captions but before recording completion, or answer generation can finish before the answer commit. Exactly-once execution across PostgreSQL, YouTube, and an answer provider is not a realistic claim. VidScribe instead makes the durable outcome idempotent: one source identity, one job, unique chunk positions, fenced ownership, and transactional replacement/publication.

## Why commit the PostgreSQL search index with the transcript chunks?

**Short answer:** The GIN index and its transcript rows are one database result, so PostgreSQL should commit or roll them back together.

**Failure scenario:** If insertion fails after old chunks are deleted inside the transaction, the transaction restores the old chunks and the previous index state; the source does not become ready with partial evidence. If a worker crashes before publication, its lease expires and another worker retries.

**Concurrency:** PostgreSQL MVCC means readers see the old committed chunk set or the full replacement. A per-job fencing token prevents an expired worker from publishing over the newer claim.

**Follow-up:** The previous implementation generated embeddings before the write transaction; that historical rationale is documented in [the superseded decision](../decisions/embedding-before-transaction.md). The current FTS design has no model call during indexing.

## What does `SKIP LOCKED` solve?

It lets concurrent worker transactions skip rows another worker is claiming instead of waiting on the same queue item. Combined with a short transaction and a lease, it distributes available jobs across workers. It does not by itself recover crashed work or fence stale results; lease expiry and token checks do that.

## How are duplicate submissions handled?

The service canonicalizes YouTube URLs to the video ID. PostgreSQL enforces unique `(source_type, external_id)`, and source plus job are inserted in one transaction. Concurrent duplicate requests converge on one source/job. Client-side button disabling is only a usability detail; the database constraint is the correctness boundary.

## Why commit chunks and `READY` together?

Chunks and ready state are one logical result. A single-client transaction replaces chunk rows and updates the source/job. Readers see the prior committed index or the complete new index. The design is simple and safe for current transcript sizes; very large imports may need staged generations.

## Why use chunk overlap?

Chunk boundaries can split a fact or explanation. VidScribe retains whole trailing transcript segments in the next chunk so citations remain aligned to caption timestamps. The overlap is approximate because it does not split a segment. The algorithm enforces forward progress and tests adjacent chunk overlap and time bounds.

## Why PostgreSQL full-text search instead of Gemini embeddings?

**Short answer:** It keeps full transcripts local and avoids requiring Ollama while still using the existing PostgreSQL system of record.

**Deep answer:** Migration 004 adds a GIN expression index over English `to_tsvector(content)` and makes historical vectors nullable without deleting them. Queries use parameterized PostgreSQL text search, restrict matches to one source, and rank them with `ts_rank_cd`. The result then grounds a Gemini answer with only matched excerpts. This removes embedding model compatibility from the current RAG path.

**Trade-off:** FTS cannot match synonyms or paraphrases unless words overlap, and current stemming is English-only. A future hybrid path needs a retrieval evaluation, embedding-version metadata, and explicit permission for any full-transcript cloud transfer.

## What is RAG and what are citations proving?

RAG retrieves transcript chunks related to a question, then places those passages in the LLM prompt. The citation links are generated by the application from retrieved database rows and timestamp bounds, not invented by the model. A citation proves which text VidScribe supplied as evidence; it does not guarantee the model's answer is correct. Retrieval and answer quality need evaluation.

## Why separate local retrieval from the answer provider?

**Short answer:** Retrieval stays local and stable while users change which provider writes the answer. No answer-provider change reindexes a source.

**Deep answer:** The local PostgreSQL FTS index is provider-independent. RAG retrieves passages before resolving the selected answer adapter, so switching between Gemini/OpenAI/Claude/Ollama affects only answer generation. Provider-specific HTTP formats stay behind an adapter registry, and completed messages record provider/model provenance. Cloud models receive only the question and selected transcript excerpts, not the full transcript index.

**Failure and concurrency:** A provider switch affects future requests. An in-flight request continues with the model/provider it resolved at start and records that provenance if its turn lease remains valid. If the selected provider is missing a key, rejects it, rate-limits, or times out, VidScribe stores a safe failure and does not silently send the prompt to another provider. The question plus retrieved excerpts may be sent to a cloud provider and can incur charges.

**Trade-off:** The user manages provider keys and model IDs; cloud model calls leave the local machine. A new provider needs a maintained adapter and contract tests. Arbitrary API URLs are deferred because they would create an SSRF boundary.

## How are provider API keys protected?

The browser submits a key to the local backend and clears it after save. The backend encrypts it with AES-256-GCM before writing ciphertext to PostgreSQL. A per-user encryption key is stored in the OS application-config directory outside the repository. The API returns only a configured flag and never logs the credential. This reduces risk from a database-only leak but does not protect against compromise of the same account/computer. The database and encryption key must be backed up separately if credentials need to survive restore; otherwise the user can re-enter their provider keys.

**Alternatives:** An OS keychain/cloud vault provides more managed key rotation and deployment support, but adds platform or hosted-service complexity that is premature for a single-user loopback application. Plaintext in the database or browser storage is not acceptable. Environment variables remain appropriate for deployment-wide infrastructure configuration, not interactive provider switching.

## What happens when YouTube, PostgreSQL, or the selected answer provider fails?

The worker records a safe failure code/message and whether retry is allowed. YouTube transcript retrieval currently has no cancellation timeout, and normal pipeline failures are not retried automatically with backoff. A crashed worker is recovered through lease expiry. PostgreSQL retrieval errors persist a retryable answer failure; no-match searches return insufficient context without calling the model. Answer-provider calls use a timeout and explicit user retry.

## Why log provider token usage without storing a cost?

**Short answer:** It provides a measured baseline for a real request without presenting a fragile estimate as a bill or committing to an unused usage ledger.

**Deep answer:** Gemini, OpenAI, Anthropic, and Ollama expose usage through different response fields. Adapters normalize those into input/output/total and provider-specific cache or reasoning fields. The LLM service logs usage beside provider latency; conversation persistence and HTTP middleware record wider stage durations. A fresh request ID correlates one attempt, while the turn ID groups retries. The answer still succeeds if a provider omits usage metadata. Logs can be lost and are not appropriate for billing or aggregate concurrency decisions.

**Failure/concurrency:** A valid response without usage fields remains usable. If an answer call is repeated after a persistence failure, each provider request may incur usage even when only one answer is ultimately saved. Request and turn IDs make separate attempts distinguishable, but local logs do not provide durable percentiles or a capacity metric.

**Follow-up:** Persist per-turn usage when users need history or quota policy. Before cost estimates, add versioned provider pricing and explicit rules for cache/reasoning token classes. Before capacity claims, add request-correlated durable metrics.

## Why use an idempotency key for chat turns?

**Short answer:** A client-generated UUID identifies one logical question across retries, so a lost response does not create a duplicate conversation turn or repeat completed inference.

**Deep answer:** The API binds a turn UUID to the submitted question and scopes it to a source conversation. A unique key on `(conversation_id, turn_id, role)` allows one user and one assistant message for that request. The repository locks the conversation while deciding whether the key is new, active, complete, or retryable. Reusing a UUID with different question text is rejected. A live generation lease returns pending; a completed turn returns its stored answer/citations; an expired or retryable turn is reclaimed with a new token.

**Failure/concurrency:** Two requests with the same key serialize on the conversation row, so only one claims a new assistant message. If the first response is lost after commit, repeating the key replays the result. If inference succeeded but its database commit failed, model work may repeat after lease expiry; this is at-least-once inference with idempotent durable publication, not exactly-once execution.

**Follow-up:** A different key is a distinct question and may run concurrently. The browser currently allows one pending question per source, but the server needs a model concurrency limit before supporting higher load.

## Why commit messages before inference, but keep inference outside a transaction?

The short transaction commits the user question and pending assistant placeholder so a refresh can restore the work and another request can recognize it. The database transaction ends before retrieval/answer-provider calls, so provider latency holds neither a row lock nor a connection. A later short transaction atomically stores answer, citations, and provider provenance or a safe failure. A lease token fences a stale request if another request resumes the turn.

**Trade-off:** If inference succeeds and the database commit fails, the model call can be repeated after expiry. Keeping a transaction open would not make PostgreSQL and a provider API atomic; it would only add long-held locks and connections.

## What is missing before calling this a production service?

- Execute PostgreSQL integration tests for migrations, competing claims, expiry/reclaim, stale-token fencing, rollback, chat idempotency, and cascade deletion on a disposable database.
- A transcript timeout/cancellation contract, bounded worker/model concurrency, and explicit graceful-shutdown deadline.
- A durable background answer worker if measured HTTP wait times or abandoned-request recovery needs justify asynchronous execution.
- Durable metrics, distributed traces, operational alerts, and backup/restore procedures. Local HTTP request correlation now exists, but it is not an observability backend.
- Authentication and ownership before supporting remote or multi-user access.
- Retrieval evaluation and measured vector indexing decisions.

See [provider usage telemetry without a billing ledger](../decisions/provider-usage-telemetry.md) for the current boundary and interview explanation.

The current system is a reliable local-first vertical slice with explicit failure boundaries; it is not yet an operated multi-user production service.

## Why separate the chat turn ID from the request ID?

The client turn UUID is an idempotency key for one logical question and remains the same if the browser retries. The server generates a fresh request UUID for every HTTP attempt and returns it as `X-Request-Id`. Logs carry both values: the request ID joins claim, retrieval, provider, persistence, and HTTP timings for one attempt; the turn ID groups retries of the same saved answer. Neither ID carries authorization, and no question, transcript, prompt, key, or raw URL is logged.

This is a local structured-log correlation mechanism, not distributed tracing. If VidScribe moves to multiple services, propagate W3C trace context and export spans to an OpenTelemetry backend.

## What does the retrieval evaluation prove?

The isolated PostgreSQL integration test uses a small human-labeled synthetic transcript. It checks that three lexical questions retrieve expected chunk IDs in the top three, records one expected paraphrase miss, and validates the citation excerpt, source video ID, and timestamp URL generated from retrieved rows. It does not call an LLM.

This protects SQL/search semantics and citation mapping from regressions. It does not show that real user transcripts are retrieved well, that model answers are factually correct, or that a semantic index is justified. Those claims require a larger representative corpus, answer-quality review, and explicit privacy/cost decisions.

## Why test provider credentials before saving them?

VidScribe sends a short prompt to the selected model before changing persisted settings. If authentication or model access fails, the previous active provider remains intact. On success, one short PostgreSQL transaction saves the encrypted key/model and changes the active provider. The remote call stays outside the transaction; a database failure afterward can mean the provider charged for the test without the setting being saved. The UI explains this usage risk, and the test response text is discarded.

## Why keep the theme preference in the browser?

The current app has one local user and no account/profile service. Light/dark choice is presentation state, so browser local storage is enough and avoids a database migration or settings API for a preference. A future account/workspace system could move the preference to a user profile if cross-device synchronization becomes useful.
