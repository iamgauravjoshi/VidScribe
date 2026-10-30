# Chat Conversation Service

## Purpose

Persist source-scoped questions and answers so a user can leave and reopen a source without losing the discussion. The service coordinates idempotent answer turns, source readiness, existing RAG inference, answer leases, and durable citations.

## Responsibilities

- Load a source's ordered conversation and convert persistence records into API DTOs.
- Verify the source is ready before accepting a new question.
- Claim a turn using its client request UUID and bind that UUID to the submitted question.
- Commit a user message and pending assistant message before external inference begins.
- Run RAG without holding a database transaction or row lock.
- Renew the pending assistant lease while inference is active.
- Persist the answer plus citation snapshot, or a safe failure and retry decision, only while holding the current fencing token.
- Return a completed result or tell the API that a duplicate submission is already in progress.

## Non-responsibilities

- HTTP validation and status selection belong to validators/controllers.
- SQL, unique constraints, row locking, and message state transitions belong to the conversation repository and migrations.
- Transcript retrieval, prompt construction, and citation generation belong to the RAG stack and retrieval repository.
- User authentication, workspace ownership, multiple named conversations, chat streaming, and answer queue scheduling are not implemented here.

## Dependencies

- `source.service` verifies the source exists and is `READY`.
- `conversation.repository` reads/writes conversations and messages in PostgreSQL.
- `rag.service` retrieves source-scoped transcript chunks with PostgreSQL full-text search. It requests answer text through the selected provider adapter.
- Shared config supplies `CHAT_GENERATION_LEASE_DURATION_MS`; structured logs capture source, turn, message, duration, citation count, and safe failure code.

Dependency direction: controller → conversation service → source service/repository, conversation repository, and RAG service. The service does not import an Express request or response.

## Input and output

`askSourceQuestion` receives `{ sourceId, turnId, question }`. `turnId` is a UUID generated once by the client and reused for retries. It returns either:

- `COMPLETED`: persisted assistant/user message IDs, answer, and citations; or
- `PENDING`: the existing message IDs because another request owns an unexpired generation lease.

`getSourceConversation(sourceId)` returns ordered message DTOs with role, status, text, citations, safe failure, attempt count, expiry, and timestamps.

## Execution flow

1. Read the source and reject a non-`READY` source.
2. In a short transaction, lock the conversation row. If `turnId` is new, insert the user message and leased pending assistant message. If it exists, compare the original question and return/claim the existing turn based on its state.
3. For a newly claimed turn, run `answerQuestion` outside the transaction. A heartbeat extends the database lease while retrieval and selected-provider calls are in progress.
4. Before publication, assert the heartbeat still owns the turn. A short repository transaction updates only a pending assistant row with the same fencing token and writes answer text plus JSON citations.
5. On an inference error, classify a safe code/message and retryability, then mark the assistant row failed only if this request still owns the token. The user message remains intact.
6. Always stop the heartbeat. If ownership was lost, discard stale output and return the current conversation state through the API's retry/poll behavior.

The database row is the source of truth. The browser reloads it with `GET /api/sources/:sourceId/conversation` and polls while an assistant message is pending.

## Error handling

- Missing source/conversation: `SOURCE_NOT_FOUND`.
- Non-ready source: `SOURCE_NOT_READY`.
- Same UUID with different question: `IDEMPOTENCY_KEY_REUSED` (409).
- Duplicate request while lease active: normal pending outcome (202), not another generation call.
- Stored non-retryable failure: `ANSWER_RETRY_NOT_ALLOWED` (409).
- Retryable provider/database/inference failure: preserve the user question and store a safe assistant failure with `retryable=true` where policy allows.
- Lease loss: discard the generated answer; the stale token cannot complete or fail the message.
- Failure to persist the failure: log the recording error without exposing provider/database internals. The turn can remain pending until lease expiry and then be resumed.

Unexpected errors remain handled by centralized API middleware. Raw stack traces and provider response bodies are not returned to the browser.

## Concurrency and idempotency

The unique key `(conversation_id, turn_id, role)` ensures at most one user and one assistant row per turn. `beginAnswerTurn` locks the one conversation row, which serializes decisions for a source and prevents two requests with the same key from both creating a pair. The first request claims the assistant row. A concurrent duplicate observes its live lease and returns pending. Completion and failure transactions lock parent conversation before assistant message, matching the parent-to-child order used when deleting a source; this avoids a lock inversion with the database cascade.

An expired pending turn or retryable failed turn is reclaimed with a new random generation token. Completion/failure updates require the current token, so an older request that finishes later cannot overwrite the new owner. Inference is at-least-once: if model work succeeds but the durable completion transaction fails, the answer may be generated again after lease expiry. The product guarantee is one durable turn pair and one current-writer publication, not exactly-once model execution.

Different turn IDs can still run in parallel from multiple tabs or clients. The current UI allows only one pending turn per source, but that is not a server-side throughput limiter. Add bounded per-model concurrency before scaling beyond local single-user use.

## Database interaction and transaction boundary

`conversations` is one-to-one with `sources`, and the conversation is created in the same transaction as source/job creation. Migration `002_source_conversations.sql` also seeds conversations for existing sources. User plus pending assistant insertion is atomic. Answer text, citations, and provider/model provenance, or failure fields, update atomically in a second transaction. No PostgreSQL transaction remains open during model calls.

Deleting a source cascades through its conversation and messages. The current retention model does not support retaining chat after source deletion.

## External calls and resource behavior

RAG searches the local PostgreSQL index, then dispatches answer generation through the configured Gemini, OpenAI, Anthropic Claude, or optional Ollama adapter. Provider calls have a configured timeout and sanitized errors. The selected provider and model ID are persisted on completed assistant messages, so history remains attributable if settings change later. The conversation service does not hold a database client during those calls. A timer periodically renews the answer lease; renewal failure is treated conservatively as lost ownership.

The HTTP request remains open while the first inference runs. The message is durable before this wait begins, so a browser refresh can see pending state. There is no background chat worker or push channel; after a process crash, the user can resume an expired turn when reopening the source.

## Testing strategy

- Validator unit test: required question, length bounds, request UUID shape.
- PostgreSQL integration test: conversation creation with source; competing identical requests; one user/assistant pair; completed replay; mismatched key rejection; citation persistence; retryable and non-retryable failures; expiry and fencing; cascade deletion.
- Service tests can stub RAG and repository boundaries to verify success, safe failure classification, heartbeat renewal/loss, and no duplicate inference for completed/in-progress turns.
- Manual UI test: ask, refresh during inference, reopen after completion, induce model failure, retry the same turn, and open a persisted citation.

The current suite includes provider request-shape/secret tests and opt-in PostgreSQL scenarios. On 2026-10-29, all 13 backend tests passed against the isolated test database, including provider selection and message provenance. A browser smoke check confirmed the new provider settings UI. No API credentials were configured, so it did not exercise real provider inference or make a billable request.

## Future evolution

If synchronous inference causes long HTTP waits or users need automatic recovery when no browser is open, represent generation as a durable answer job and let a worker claim the same message/lease state. Keep the request UUID, conversation/message schema, citation snapshot, and fencing token contract. Add a broker only if measured work volume or independent scaling justifies operating one. Add multiple conversations only when users need separate threads; change the one-to-one constraint and API explicitly rather than pretending the current `conversations` table already implements that experience.
