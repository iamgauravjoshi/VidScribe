# Decision: Normalize provider usage without a billing ledger

**Status:** Accepted for the single-user local product boundary  
**Date:** 2026-10-30

## Problem

VidScribe needs to measure a real answer's provider latency and token usage before choosing whether to build cost tracking, concurrency controls, streaming, or background answer generation. Gemini, OpenAI, Anthropic, and Ollama return usage fields in different response shapes, and some responses may omit them.

## Naive approach

Discard usage and judge capacity from how fast one answer feels, or immediately store token counts and multiply them by a hard-coded price to display a cost.

## Why that is problematic

- A qualitative timing guess is not enough to compare time spent in provider generation with the complete chat turn.
- Provider response formats use different names and token categories, so logs are hard to compare without normalization.
- A response can omit usage metadata; generation must remain successful if its text is valid.
- Hard-coded prices can become stale and may not reflect model version, cached/reasoning token classes, region, tier, or account-specific terms.
- Provider calls can be repeated after a crash or persistence failure, so token use is not necessarily identical to successful message count.
- Logs may be rotated and currently lack an end-to-end request ID, so they cannot support billing or reliable multi-request aggregation.

## Chosen approach

Each adapter maps provider-reported counts into an optional shared usage structure: input, output, total, cached input, cache-creation input, and reasoning tokens where available. The LLM service logs these fields alongside provider, model, and generation duration. The conversation service separately logs end-to-end turn duration. Usage is not written to the message schema, aggregated, or converted into currency.

## Why this is appropriate now

This is enough to inspect one manually triggered answer and compare provider time, end-to-end time, and token counts without adding a migration or presenting a fragile cost estimate as fact. It keeps provider-specific parsing inside adapters and leaves successful answer behavior independent of optional telemetry.

## Example

A Gemini call returns 520 prompt tokens, 90 candidate tokens, and 12 reasoning tokens in its usage metadata. VidScribe records normalized counts with the model and provider request duration. The saved answer still stores provider/model provenance and citations, but not usage. An operator can inspect the one-off baseline without the app claiming a dollar amount.

## Failure scenario

If Gemini returns valid answer text but no `usageMetadata`, the adapter returns the answer and omits usage. If token fields are malformed, they are omitted rather than causing the answer request to fail. If a provider call succeeds but the message transaction fails, the model request may be repeated after lease expiry; each completed provider request can have its own operational log entry.

## Concurrency scenario

Two simultaneous answers may each produce provider log entries, but the current logs have no common request-correlation ID spanning retrieval, provider generation, and message persistence. Do not use these logs to infer a concurrency limit from aggregate demand. Add request correlation and durable metrics before load testing or making operational guarantees.

## Trade-offs

- **Gain:** comparable provider-reported usage fields and measured generation latency with no migration or new billing semantics.
- **Cost:** data can be lost with log rotation, cannot be queried per saved turn, and cannot be used for customer billing or historical dashboards.
- **Uncertainty:** token categories are not perfectly equivalent across vendors. Normalization preserves provider distinctions where known instead of pretending every token count has the same cost.

## Alternatives considered

- **Persist usage per assistant message:** useful for user-visible history and cost analysis, but requires a schema/API/UI contract and decisions for missing usage, retries, and changing model pricing. Defer until a product requirement exists.
- **Calculate cost immediately:** premature without a versioned pricing catalog and transparent provider-specific token rules. Defer; do not infer exact spend from token counts alone.
- **Build Prometheus/OpenTelemetry metrics now:** appropriate for a deployed service with operational SLOs, but adds infrastructure and cardinality design before there is measured traffic. Start after the single-call baseline and deployment needs justify it.
- **Measure only end-to-end time:** simpler but cannot tell whether slow requests are caused by retrieval or provider inference.

## Interview explanation

“Provider usage fields are useful for deciding what to build next, but token counts alone are not a billing system. I normalized the vendor response shapes and log counts with provider latency, while preserving successful generation when usage is missing. I did not add a database ledger or hard-coded price table because pricing and token categories differ by provider and can change. Before using this for billing or capacity guarantees, I would add request correlation, durable metrics, and an explicit pricing versioning policy.”

## References

- [Gemini GenerateContent API usage metadata](https://ai.google.dev/api/generate-content)
- [OpenAI Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages)
- [Ollama chat API](https://docs.ollama.com/api/chat)
