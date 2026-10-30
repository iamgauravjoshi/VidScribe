# Correlate chat requests and measure local retrieval

**Status:** Accepted for the single-user local product boundary  
**Date:** 2026-10-30

## Problem

Provider connectivity has been manually verified, and provider/RAG services already log their own durations. Those log events could not be joined across a whole answer attempt. Meanwhile, PostgreSQL full-text retrieval had only a few isolated assertions rather than a labeled query baseline. We need evidence about retrieval and stage latency before deciding whether to change search or add asynchronous generation, concurrency controls, or cost reporting.

## Naive approach

Reuse the client turn UUID as a trace ID, log the whole request URL/body to aid debugging, and treat one successful AI answer as proof that retrieval is good. Alternatively, immediately add an observability database and billing schema.

## Why that is problematic

- A turn UUID identifies one logical question across retries; a trace ID should identify one HTTP attempt. Reusing it hides retry and duplicate-attempt behavior.
- URLs, query strings, questions, transcripts, and prompts can contain sensitive user data or credentials. Logging them creates unnecessary disclosure risk.
- A successful model response does not show that the top-ranked passages were relevant or that citations point to the supporting segment.
- A persistent analytics database or dollar estimate is premature without a retention, pricing, and aggregation contract.

## Chosen approach

Generate a fresh server-side UUID for each HTTP request and return it as `X-Request-Id`. Propagate it with source ID and the stable chat turn ID through turn-claim, retrieval, provider-generation, answer-persistence, and HTTP-completion logs. Record stage durations and provider usage when supplied. Log normalized route templates only; never log request bodies, raw URLs/query strings, transcript excerpts, prompts, or keys.

Add a versioned synthetic retrieval fixture to the isolated PostgreSQL integration test. Four human-labeled questions target known chunk indexes at `k=3`, with a minimum case recall of 0.75. Three lexical queries should retrieve their expected evidence. One intentionally paraphrased “subtitles” query records the known lexical-search miss against transcript wording. For retrieved expected evidence, assert source identity and exact citation excerpt/timestamp mapping. Keep the evaluation provider-free.

## Example

The user submits a question with turn UUID `T`. The server returns request ID `R1` in the response header. Claim, retrieval, provider, persistence, and HTTP-completion events share `R1`, `T`, and the source ID. If the browser retries that same turn, the next request receives `R2` while preserving `T`. Operators can distinguish the request attempts while still grouping them as one logical chat turn.

## Failure scenario

If the database search fails, the RAG error event records request/source/turn IDs, a safe error code, and retrieval duration; the middleware records the final HTTP status and duration. No question or transcript text is required to join the events. If the Node process crashes before response completion, the final HTTP event may be absent; local console logs are not a durable audit trail.

If a test query misses its labeled evidence, the integration evaluation fails without calling a provider. If the expected paraphrase miss begins to hit due to a PostgreSQL dictionary or query change, the test also fails so the baseline can be reviewed rather than silently drifting.

## Concurrency scenario

Concurrent requests receive independent UUIDs. Two HTTP attempts carrying the same turn UUID can be distinguished in logs; the conversation row lock, message uniqueness, and generation lease still decide whether they are duplicates, pending, or eligible for retry. A request ID is observability metadata and does not participate in authorization, idempotency, or lease ownership.

## Trade-offs

- **Gain:** one searchable correlation value for a request path; a second stable value for retry grouping; stage-level latency; repeatable local search and citation checks; no schema change.
- **Cost:** logs remain ephemeral and do not provide percentiles, alerting, or per-user historical usage. The synthetic evaluation set is small and cannot prove answer factuality or performance on real transcripts.
- **Privacy:** structured logs contain only opaque IDs, route templates, statuses, timing, counts, provider/model, and provider-reported usage. Model name is configuration metadata; no prompt content is logged.

## Alternatives

- **Persist usage and cost now:** deferred until there is a user-facing history/quota requirement and a versioned pricing model.
- **OpenTelemetry tracing:** appropriate once VidScribe spans multiple deployed processes or has operational SLOs; for a local single-process app, a request UUID and structured logs provide a smaller first step.
- **Use turn UUID for tracing:** rejected because it merges separate retries into one operation and can be client-controlled.
- **Call a real model in retrieval tests:** rejected because it would make evaluation nondeterministic, secret-dependent, and potentially billable.
- **Add semantic search now:** deferred until a larger labeled corpus shows that lexical misses are common enough to justify model/index/privacy complexity.

## Interview explanation

“The chat turn ID provides idempotency across retries, while a server-generated request ID identifies each HTTP attempt. I carry both through structured logs so I can measure API, retrieval, provider, and persistence time without logging prompts or transcript text. In parallel, I use a small PostgreSQL-backed labeled query set to establish a lexical retrieval baseline and verify citation mapping without an external model call. It’s diagnostic groundwork, not a production tracing or answer-quality guarantee.”
