# Architectural Evolution Log

The repository history does not provide a reliable dated record of every earlier learning step. This ledger begins with the documented baseline and records changes made as the product architecture evolves.

## Baseline — before source lifecycle phase

- One Express process performed YouTube ingestion synchronously in the request path.
- The database used `videos` and `video_chunks`; status values were video-specific.
- A conditional update guarded processing, and a transaction wrote chunks with completion state.
- There was no checked-in migration, worker lease, retry endpoint, or user-facing source library.

## 2026-10-29 — Source lifecycle vertical slice

### Previous approach

The request handler started transcript retrieval and model inference inline. A process crash could strand a processing row. The single-page UI could not represent a durable library or recoverable processing state.

### Problem discovered

Slow external work tied up the HTTP request; local in-memory state could not survive refresh; stale processing had no owner or recovery policy; video-specific storage and route names made the product boundary too narrow.

### New approach

- Add an explicit schema migration that renames `videos`/`video_chunks` in place, maps old processing states to source states, adds a durable `ingestion_jobs` table, and seeds jobs for preserved sources.
- Create sources and queue records in one transaction, with `(source_type, external_id)` uniqueness.
- Run one PostgreSQL-backed polling worker loop per backend process. It claims with `SKIP LOCKED`, tracks phases, renews expiring leases, and uses a lease token to fence stale workers.
- Generate embeddings before the final transaction; atomically replace chunks and publish `READY` after a lease-checked claim.
- Add list/read/retry/delete/chat source API routes, typed citations, and React library/source workspace states.
- Proxy `/api` through Vite in development and remove unused video-only API/UI modules.
- Add unit tests for URL parsing, request validation, and segment-aware chunk boundaries.

### Why this is better

It makes lifecycle state durable and inspectable, keeps ingestion out of HTTP latency, lets multiple backend processes share work safely, and ensures a source cannot be announced ready with a partial index. The user sees real persisted phases and can retry the existing source.

### Trade-offs and deferred work

The worker shares the API process and therefore the same deployment/resource limits. PostgreSQL polling adds periodic queries. Ingestion runs at least once after lease expiry, so model work can be repeated, but token fencing and idempotent final publication prevent stale or duplicate rows from becoming visible. There is no exponential backoff, independent worker service, metrics/tracing, or live database integration result yet. The migration must be explicitly applied and has not been verified against a live local database in this environment.

### References

- [Migration](../../backend/migrations/001_source_processing.sql)
- [Worker and ingestion](../../backend/src/services/ingestion/worker.service.ts), [ingestion service](../../backend/src/services/ingestion/ingestion.service.ts)
- [Job repository](../../backend/src/repositories/ingestion-job.repository.ts)
- [Source API guide](../services/source-library-api.md)
- [Job decision](../decisions/postgres-backed-ingestion-jobs.md)

## 2026-10-29 — Persisted conversations and idempotent answer turns

### Previous approach

The source workspace held question and answer messages only in React state. Refreshing discarded history. A retry created a second visible user turn, and a lost HTTP response could not tell the client whether inference or persistence had completed.

### Problem discovered

The product promises users can return to saved sources and prior answers. That promise requires more than a messages table: the API must distinguish new, in-progress, completed, and retryable turns under concurrency, while citations and safe failures remain associated with the same answer.

### New approach

- Add a one-to-one `conversations` relation per source and seed it for existing sources. Add constrained `messages` rows with role, status, JSON citations, failure metadata, UUID turn ID, and generation lease fields.
- Create the conversation in the same transaction as a new source/job; source deletion cascades through its conversation and messages.
- Add `GET /api/sources/:sourceId/conversation`. Require `requestId` (UUID) on chat submission and return either a completed answer or a pending turn.
- Under a short transaction, lock the conversation and create a user/assistant pair once. Run RAG outside the transaction. Persist completion or safe failure only if the current lease token still owns the assistant message.
- Restore messages in the workspace, poll pending answers, preserve the turn ID for retries, and show citations/failure/resume state from persisted messages.
- Extend the opt-in PostgreSQL integration scenario to exercise concurrency, replay, failure/retry, lease fencing, and cascade deletion.

### Why this is better

Refreshing or navigating away no longer loses conversation history. A request retry with the same key does not create duplicate messages or repeat completed inference. Failure is visible in the history and retryable in place. The transaction is not held during Ollama inference, and a stale request cannot overwrite a newer lease owner.

### Trade-offs and deferred work

Inference remains synchronous from the POST request, so a browser may wait for the existing model timeout. A crashed request is recovered when the user returns and retries after lease expiry; there is no background answer worker or automatic recovery scheduler yet. External inference is at-least-once when persistence fails after a successful model call. Multiple named conversations, authentication/ownership, and chat streaming are deferred. The migration and expanded integration suite still need a live PostgreSQL run.

### References

- [Conversation migration](../../backend/migrations/002_source_conversations.sql)
- [Conversation repository](../../backend/src/repositories/conversation.repository.ts) and [service](../../backend/src/services/chat/conversation.service.ts)
- [Persisted chat decision](../decisions/persisted-conversations-and-idempotent-turns.md)
- [Conversation service guide](../services/chat-conversation-service.md)

## 2026-10-29 — Isolated PostgreSQL integration target

### Previous approach

The opt-in PostgreSQL integration test depended on an externally supplied disposable database URL. The repository did not provide a separate local database target for running it, so migrations and concurrency cases were easy to leave unverified.

### New approach

- Add `docker-compose.test.yml` with a dedicated `vidscribe_test` database, test-only credentials, a distinct named volume, and a loopback-only port.
- Document start, run, and reset commands. The test URL continues to be guarded by the integration suite's database-name and empty-source checks.

### Why this is better

It makes migration and concurrency verification repeatable while keeping the test database separate from the ordinary development database. The integration test still requires an explicit test URL, so `npm test` cannot silently write to a developer database.

### Trade-offs and deferred work

The test container persists across runs until explicitly reset with `down -v`. At the time this test target was added, only its Compose syntax had been checked; the database, migrations, and integration suite were verified later in the live-database entry below.

### References

- [Disposable test database](../../docker-compose.test.yml)
- [Run instructions](../../README.md)
- [PostgreSQL integration test](../../backend/test/postgres-lifecycle.integration.test.ts)

## 2026-10-29 — Live database and conversation UI verification

### Previous approach

The migration and database integration scenarios had only been described and syntax-checked; there was no evidence that the schema, concurrency cases, and UI agreed against a running PostgreSQL instance.

### New approach

- Start the isolated Compose test database and apply migrations `001` and `002`.
- Run the full backend suite against that disposable database: 9 passed, 0 failed, 0 skipped.
- Seed a temporary source and persisted conversation states, then open the source workspace in a browser.
- Confirm the ready-source view, completed answer, timestamp citation link, retryable failure action, and pending-answer resume action.
- Delete the fixture and stop the container while retaining its named test volume for future local runs.

### Why this is better

The verification now covers the actual PostgreSQL constraints and transactions rather than relying on mocks alone, and checks that persisted API state maps to the expected UI controls after a reload.

### Limits and next work

Ollama was unavailable, so this check deliberately did not run model inference. It verifies restored/persisted states, not a full live question-to-answer request. At this point, the Gemini answer key alone did not remove Ollama from the end-to-end path because embeddings were also local. The user chose not to install Ollama; the resulting retrieval decision is recorded in the 2026-10-30 entry below.

### References

- [Project verification notes](../PROJECT.md#verification)
- [Conversation service guide](../services/chat-conversation-service.md#testing-strategy)

## 2026-10-29 — Multi-provider answer generation and encrypted credentials

### Previous approach

The RAG answer path called Ollama directly, so answer generation was coupled to one local model runtime. There was no user-facing provider configuration or persisted record of which model generated a saved answer.

### Problem discovered

Users need a choice between local and hosted answer models. Adding provider-specific branches to RAG would mix HTTP protocol details with retrieval logic. Reusing provider selection for embeddings would also risk making existing source vectors incompatible. API keys must not be placed in frontend storage, plaintext database fields, or logs.

### New approach

- Add a provider-neutral adapter registry for Gemini, OpenAI Responses, Anthropic Claude Messages, and Ollama answers; seed Gemini as the default active answer provider.
- Keep Ollama as the embedding provider for transcript indexing and question retrieval. Provider switching affects answer generation only.
- Add an AI provider settings page, validated settings API, model ID fields, and key replacement flow. The browser receives configuration status only.
- Encrypt cloud API keys with AES-256-GCM before persisting ciphertext in PostgreSQL. Keep the encryption key under the OS user's application-config directory, outside the repository.
- Persist answer provider/model provenance alongside completed assistant messages. Do not silently fail over to another provider.
- Apply migration `003_ai_provider_settings.sql`, add provider/request/secret tests, and update project/service/decision/interview documentation.

### Why this is better

Provider-specific request formats sit behind a narrow adapter boundary. Users can change answer models without re-embedding content. Saved answers retain provenance even when the active provider later changes. Cloud credentials are not exposed in the settings response or logs, and provider outages cannot change the destination of private prompt data through an invisible fallback.

### Trade-offs and deferred work

The user owns provider accounts, model IDs, and potential usage charges. Restoring encrypted keys requires the separate local key file; losing it means re-entering keys. Only named vetted providers are accepted; arbitrary API endpoints, streaming, usage controls, key deletion, and automatic retries are deferred. API keys are encrypted at rest against a database-only disclosure, not protected from compromise of the same user account. The API remains loopback-only and has no multi-user access boundary.

### Verification

Backend and frontend builds passed. The isolated PostgreSQL test suite passed 13 tests with migrations `001`–`003`, including provider switching and message provenance. Provider HTTP shape and credential encryption were tested with mocked responses; a UI smoke check confirmed Gemini is selected by default and that all provider settings are present. No provider key was configured, so no live cloud request or billable inference was made.

### References

- [Provider service guide](../services/llm-provider-service.md)
- [Architecture decision](../decisions/multi-provider-generation-and-key-storage.md)
- [Provider settings migration](../../backend/migrations/003_ai_provider_settings.sql)
- [Project guide](../PROJECT.md#reliability-boundaries-and-known-limits)

## Next steps after provider configuration (recorded 2026-10-29)

1. After the user configures a provider key, run one manual end-to-end answer and verify the configured model/account behavior and latency; this is deliberately outside CI to avoid requiring secrets or incurring cost.
2. Use measured latency and recovery needs to decide whether to move answer generation into a PostgreSQL-backed worker while retaining the existing turn IDs, lease fencing, and durable message states.
3. Add bounded model concurrency, request correlation, metrics, and traces as deployment needs grow.

## 2026-10-30 — Normalize provider usage for a live baseline

### Previous approach

Provider adapters returned generated text only. Although provider and request duration were logged, the app discarded token usage supplied by successful generation APIs.

### Problem discovered

The next product check needs real provider latency and usage evidence before choosing between billing, throttling, streaming, or asynchronous answer generation. A hard-coded cost estimate would be misleading without a maintained price catalog and account-specific billing context.

### New approach

- Normalize input/output/total tokens and available cache/reasoning counts for Gemini, OpenAI, Claude, and Ollama responses.
- Include optional normalized usage in the provider result contract and structured completion logs. An answer succeeds even when its provider omits usage metadata.
- Keep usage out of the database and do not calculate currency yet. The current logs are a manual diagnostic baseline, not durable billing/accounting data.

### Why this is better

The API-specific fields are contained inside provider adapters and a common usage DTO. We can record one real Gemini answer's measured generation duration and token counts before deciding whether product usage history, limits, or streaming has enough value.

### Trade-offs and deferred work

Logs can be rotated or lost and are not correlated end to end across concurrent turns. No cost estimate is produced because pricing changes by model, token category, caching, and account terms. Add persistence and request correlation before using this data for customer billing or aggregate capacity decisions.

### Verification

Backend TypeScript build passed. Provider adapter tests cover usage parsing and omission of absent optional fields; the backend suite passed 12 tests, with the PostgreSQL integration test skipped because `VIDSCRIBE_TEST_DATABASE_URL` was not set. No real Gemini call has been made yet. The app's current default `gemini-3.8-flash` appears in Google's current Gemini API model catalog as a stable model; availability still depends on the user's API account.

### References

- [Gemini GenerateContent response usage metadata](https://ai.google.dev/api/generate-content)
- [Ollama chat API response usage counters](https://docs.ollama.com/api/chat)
- [Provider service guide](../services/llm-provider-service.md#generation-flow)

## 2026-10-30 — Local PostgreSQL full-text retrieval without Ollama

### Previous approach

Transcript ingestion and every question required Ollama embeddings, with vectors stored in pgvector. Gemini was only an answer provider.

### Problem discovered

The user chose not to install Ollama and requested Gemini for answers. Sending the full transcript to Gemini for embeddings would change the privacy boundary and create separate embedding usage. A retrieval path was needed that kept transcript indexing local.

### New approach

- Add migration `004_postgres_full_text_search.sql` with a GIN expression index over English transcript content and make legacy vectors nullable without deleting them.
- Replace transcript/query embeddings with source-scoped PostgreSQL full-text retrieval ranked by `ts_rank_cd`.
- Keep stopword-only/no-hit queries on the safe insufficient-context path; do not make an answer-provider call without matching evidence.
- Remove Ollama from required config, health, ingestion, and question retrieval. Keep Ollama only as an optional local answer adapter.
- Update user-facing privacy copy to say transcript indexing is local while Gemini receives the question and matched excerpts for answer generation.

### Why this is better

This meets the requested no-Ollama workflow and avoids full-transcript cloud indexing. PostgreSQL remains the system of record, search index, and durable job store. Existing source rows and vector values remain compatible, while new chunks can be indexed without model calls.

### Trade-offs and deferred work

Lexical FTS misses paraphrases and synonyms without overlapping words; current ranking is English-specific and is not a semantic confidence score. Existing pgvector values are preserved but unused. Revisit semantic/hybrid retrieval only after a retrieval-quality evaluation and an explicit data-transfer decision. Large hosted databases need an online GIN index-build plan.

### Verification

Backend and frontend builds passed. The isolated PostgreSQL suite passed all 13 tests with migrations `001`–`004`; it verifies source-scoped FTS matches, positive rank, stopword-only no-match, vectorless chunk persistence, and atomic rollback/publication. Migration `004` was also applied to the local development database. No Gemini API key or source was configured for this phase, so no real answer call has occurred yet.

### References

- [Local retrieval decision](../decisions/local-postgres-full-text-retrieval.md)
- [PostgreSQL full-text search service](../services/postgres-full-text-search.md)
- [Project guide](../PROJECT.md#reliability-boundaries-and-known-limits)

## 2026-10-30 — Unified AI settings, test-before-save, and appearance preference

### Previous approach

Four provider cards each had independent save and select actions. A configuration could become active without being tested. The app had no settings-level appearance section or persistent theme choice.

### Problem discovered

Users must understand a single provider/model/key setup flow and learn whether the selected model works before saving it. Separately, theme changes should be available both where the preference is configured and from the application header.

### New approach

- Replace independent provider forms with provider selection and one shared model/key editor.
- Add a user-triggered short generation check. Successful checks atomically save the encrypted key/model and activate the provider. Failed checks preserve existing settings.
- Add Settings → Appearance with light/dark choices and a global header toggle, persisted in browser local storage.
- Keep the supported adapter list fixed; arbitrary endpoint fields from the design reference are not included because arbitrary server-side URLs would introduce SSRF risk.

### Why this is better

The user sees one current configuration at a time. A rejected key/model cannot silently replace the working active provider. Provider inference is outside the database transaction; the successful settings update and provider activation are atomic.

### Trade-offs and deferred work

The connection test sends a short prompt and can incur provider usage. A provider may successfully answer the test but the subsequent database commit can still fail, leaving usage charged without a saved setting. Usage is logged but not persisted. Theme is browser-local and does not sync across devices. Theme tests and real provider tests should be included in the next verification pass.

### References

- [AI provider settings guide](../product/ai-provider-settings.md)
- [AI provider settings service](../services/ai-provider-settings-service.md)
- [Test-before-save decision](../decisions/provider-test-before-save.md)

## 2026-10-30 — Consolidate the frontend design system

### Previous approach

Global and component styles mixed semantic palette values with repeated one-off colors, font sizes, spacing, radii, and shadows. Dark mode needed component-specific override rules because many surfaces and labels used fixed colors.

### New approach

- Add a dedicated CSS token file for light/dark semantic colors, typography, spacing, shape, elevation, and motion.
- Keep global resets separate from component/layout styling.
- Replace literal colors and repeated scale values in the app stylesheet with semantic variables.
- Use the same settings layout, focused surfaces, and responsive sidebar patterns across AI model and appearance sections.

### Why this is better

Shared roles make theme behavior and refinements predictable without adding a runtime styling package. Components describe intent; the token layer owns palette and scale values.

### Trade-offs and deferred work

CSS variables are not statically type checked. Keep the set small, document semantic additions, and review light/dark and narrow-screen layouts as shared styles change.

### References

- [VidScribe design system](../../DESIGN.md)
- [Design token decision](../decisions/semantic-design-tokens.md)

## 2026-10-30 — Correlate answer requests and establish a retrieval baseline

### Previous approach

Provider and RAG events logged their own duration, while the API logged unhandled failures. A chat turn UUID was persisted for idempotency, but no server-generated ID connected HTTP completion, retrieval, provider generation, and answer persistence. PostgreSQL integration covered full-text retrieval and source isolation with a small number of assertions, not a labeled multi-query baseline.

### Problem discovered

The user manually verified provider-backed answers, but this only proves that the integration path can work. It does not show whether the right evidence is retrieved, whether citations retain correct timestamps, or which stage accounts for latency. A turn UUID must remain stable across retries; using it as a request trace ID would hide separate HTTP attempts.

### New approach

- Generate a fresh server-side UUID for every HTTP request, return it as `X-Request-Id`, and log a safe operation name, status, and duration at response completion.
- Propagate request ID, source ID, and durable turn ID through chat claim, PostgreSQL retrieval, provider generation, persistence, and failure logs. Do not log query strings, questions, transcript passages, prompts, or credentials.
- Record a versioned synthetic retrieval fixture with four labeled questions, `Recall@3` threshold 0.75, expected citation mapping, and one deliberate lexical paraphrase miss. Run it against PostgreSQL in the isolated integration suite; it makes no AI-provider call.
- Document that user-reported provider tests succeeded, while exact model/latency/token results remain unavailable until recorded.

### Why this is better

Each HTTP attempt can be traced independently, while turn ID joins retries that refer to one saved logical question. Stage timings show time spent in claim, retrieval, provider inference, answer persistence, and the complete HTTP request. The evaluation turns the known lexical-search trade-off into a repeatable baseline before ranking changes or a semantic-search proposal.

### Trade-offs and deferred work

The request ID exists only in logs and the response header; there is no tracing backend or durable metrics store. Logs can be rotated, and a synthetic four-query corpus is not representative of real transcripts, answer quality, or production distribution. The test checks retrieval labels and citation construction, not whether an LLM's prose is factually correct. No schema migration or provider call is introduced.

### References

- [Chat observability and retrieval evaluation decision](../decisions/chat-observability-and-retrieval-evaluation.md)
- [Request context middleware guide](../services/request-context.md)
- [PostgreSQL full-text search guide](../services/postgres-full-text-search.md)
- [Project guide](../PROJECT.md#reliability-boundaries-and-known-limits)

## Next phase recommendation

The user has verified provider-backed answer generation, but no exact provider/model latency or token usage was captured. The current phase adds per-request stage timings and a synthetic PostgreSQL retrieval baseline. Next, record a small set of representative real-source question timings and provider usage (which may incur provider charges), then decide whether latency, capacity, or historical usage is the next product need. Do not infer cost from token counts without a versioned pricing policy.

## Change entry template

```markdown
## YYYY-MM-DD — Short change name

### Previous approach

### Problem discovered

### New approach

### Why this is better

### Trade-offs and deferred work

### References
```
