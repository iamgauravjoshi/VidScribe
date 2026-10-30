# Source Library API

**Implementation:** `backend/src/routes/source.routes.ts`, `backend/src/controllers/source.controller.ts`, `backend/src/services/sources/source.service.ts`, `backend/src/services/chat/conversation.service.ts`, the source/conversation repositories, and `frontend/src/services/api.ts`.

## Purpose and ownership

The source library API is the boundary between the browser and durable content state. It makes duplicate submission, current processing status, retry eligibility, removal, and source-scoped questions explicit.

Routes and controllers own HTTP details. Validators own input contract checks. `source.service.ts` owns source-level use-case decisions. Repositories own PostgreSQL SQL and transaction participation. The frontend API module owns typed request/response conversion for the browser.

## Routes

| Method / path | Input and behavior | Response |
| --- | --- | --- |
| `GET /api/health` | Dependency check | Health summary; HTTP 503 when degraded. |
| `POST /api/sources` | JSON `{ "url": "..." }`; validate and canonicalize supported YouTube URL. | `{ source, created }`; 202 for a newly queued source, 200 for an existing identity. |
| `GET /api/sources` | No body. | `{ sources: SourceDto[] }`, ordered by latest update. |
| `GET /api/sources/:sourceId` | Positive safe integer ID. | `{ source: SourceDto }`. |
| `GET /api/sources/:sourceId/conversation` | Positive safe integer ID. | `{ conversation: { sourceId, messages } }`, ordered by persisted message ID. |
| `POST /api/sources/:sourceId/retry` | No body. Only a retryable failed source may be requeued. | 202 with the same source identity. Active duplicate retry requests return current state. |
| `DELETE /api/sources/:sourceId` | Positive safe integer ID. | 204; deletion cascades to job, chunks, conversation, and messages. |
| `POST /api/sources/:sourceId/chat` | JSON `{ "question": "...", "requestId": "<uuid>" }`; source must be ready. | `{ turn }`; HTTP 200 for completed, HTTP 202 when that same turn is already pending. |

Error responses use the shared shape `{ success: false, error: { code, message, details? } }`. The browser relies on stable error codes for correcting a URL and handling unavailable sources; raw stack traces and provider bodies are not sent as UI copy.

## Duplicate and retry behavior

The service extracts the YouTube video ID and constructs a canonical URL before storage. The database unique index on `(source_type, external_id)` is the concurrency authority. Source insertion and job insertion share one transaction. Two simultaneous submissions may both receive the same source, but only one source and one job can be committed.

The retry endpoint does not create a new source. It locks the one job, checks the source's retryable failure state, resets current attempt/lease data, increments `retry_count`, and returns the updated source. A second request while the job is queued or processing is idempotent and returns the current source.

## Conversation turn lifecycle

Each source has exactly one conversation in this release. `POST /chat` takes a client-generated UUID as `requestId`; this identifies one logical turn, and the question text is bound to that key. The repository locks the conversation row and then:

1. Inserts the user message and a pending assistant message together for a new key.
2. Returns the stored answer and citations for a completed key without calling RAG again.
3. Returns `202 PENDING` while an active generation lease exists.
4. Claims an expired pending turn or retryable failed turn with a new fencing token.
5. Rejects a key reused with different question text (`IDEMPOTENCY_KEY_REUSED`) or a non-retryable failed turn (`ANSWER_RETRY_NOT_ALLOWED`).

The user/assistant pair is committed before answer work. PostgreSQL retrieval and chat inference run without a database transaction. A second short transaction stores the answer/citations or safe failure only if the generation token is still current. `GET /conversation` lets the UI restore history and poll pending state. The browser retries an uncertain or expired request using the original UUID.

The response may be lost after the transaction commits. Reusing the same request ID closes that ambiguity: a completed turn replays stored data, an active turn returns pending, and an expired turn is reclaimed. This guarantees one durable pair per turn key, not exactly-once calls to the selected answer provider.

## Failure and concurrency

- Invalid/malformed input is rejected before any write.
- Missing source returns `SOURCE_NOT_FOUND`.
- Chat on non-ready source returns `SOURCE_NOT_READY`.
- Retry on a non-retryable state returns `SOURCE_RETRY_NOT_ALLOWED`.
- Reusing a turn UUID with different question text returns `IDEMPOTENCY_KEY_REUSED`.
- A live pending chat turn returns 202 rather than starting duplicate model inference.
- Chat retries after a persisted non-retryable failure return `ANSWER_RETRY_NOT_ALLOWED`.
- Database failures are serialized by error middleware; source/job mutations use repository transactions.
- Source deletion locks the job before deleting the source, matching worker lock ordering. `ON DELETE CASCADE` removes the job, chunks, conversation, and messages.

## Current limits

There is no auth or workspace ownership because V1 is local-first and single-user. There is one conversation per source, with no named-conversation management or message editing. Answer execution remains synchronous through the POST request; no independent answer worker, push notifications, or automatic recovery scheduler exists. Source titles are currently optional and the UI falls back to the YouTube ID. API routes support only the YouTube adapter; a second source type should add a provider adapter and source-specific input validation without changing library concepts.

The HTTP server binds to `127.0.0.1` and does not enable permissive CORS. This is part of the current local-only boundary, not a substitute for authentication if the API is later exposed remotely.

## Tests

Unit tests cover source URL field validation, source ID validation, and chat question/UUID validation. The gated PostgreSQL integration test covers unique identity races, atomic source/job creation, retry races, duplicate chat turns, answer replay, citation persistence, retry eligibility, expired lease recovery/fencing, and deletion cascade. Run it against a disposable, empty test database to execute these checks.
