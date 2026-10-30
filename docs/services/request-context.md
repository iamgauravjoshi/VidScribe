# Request Context Middleware

**Implementation:** `backend/src/middleware/request-context.middleware.ts`, `backend/src/app.ts`, and the chat/RAG/provider services.

## Purpose

Give each inbound HTTP attempt a safe identifier that can connect its API, retrieval, provider, and persistence logs. The client-provided chat turn UUID remains the idempotency key for the logical question; it is not reused as the request identifier.

## Responsibilities

- Generate a cryptographically random UUID for every request.
- Return it in the `X-Request-Id` response header and expose it to downstream handlers through `res.locals`.
- Log the method, normalized route template, status code, request ID, and total response duration on response completion.
- Carry the request ID with source and turn identifiers through chat claim, retrieval, answer generation, persistence, and error logs.

The middleware does not authenticate a user, accept a client-chosen trace ID, log request/response bodies, create a durable trace, or collect metrics. It does not change HTTP response bodies or chat turn idempotency.

## Execution flow

1. The middleware runs before JSON parsing and route handlers, so malformed requests also receive a correlation header.
2. It creates a UUID, saves it in response-local context, sets `X-Request-Id`, and subscribes to the response `finish` event.
3. After route validation, the chat controller adds the validated source and turn identifiers to the response-local log context.
4. The controller passes `{ requestId, sourceId, turnId }` explicitly through the conversation, RAG, and LLM service calls.
5. Retrieval logs include elapsed search time and matching chunk IDs/scores; provider logs include provider/model, generation duration, and optional normalized usage; persistence and HTTP completion log their durations.

No transcript excerpt, question, generated prompt, API key, raw URL, or query string is included in these events. Unexpected error logs use the normalized route template rather than `originalUrl`.

## Concurrency and retries

Each simultaneous HTTP request receives a different request ID. A retry of the same chat turn reuses its stable turn UUID but gets a new request ID. This makes separate inference attempts observable without confusing them with separate logical turns. The request ID is diagnostic only and does not grant authority to claim or complete a message; database uniqueness and the generation lease token continue to provide idempotency and fencing.

## Failure behavior

If the request fails validation, the error response still carries the request header and completion log. If answer generation, retrieval, or persistence fails, the safe error behavior remains unchanged and the request ID appears in the correlated log records. A failed process may not emit the final completion event; this is expected for in-memory process-local logging and is not a durable audit guarantee.

## Testing strategy

- Unit-test UUID format, response header/local assignment, normalized route logging, and the absence of query-string secrets.
- In the isolated PostgreSQL integration test, run the labeled retrieval fixture through the real English FTS query and map retrieved rows into YouTube citation URLs/timestamps.
- Keep provider calls out of the retrieval evaluation so test execution is deterministic and does not use API credentials or incur charges.

## Future evolution

If VidScribe is deployed across multiple services, propagate a standard trace context (such as W3C Trace Context) and export spans to an OpenTelemetry backend. Add durable per-turn usage only after defining retention, retry accounting, and pricing semantics. Current request IDs and console logs are sufficient for local diagnosis, not production SLOs or billing.
