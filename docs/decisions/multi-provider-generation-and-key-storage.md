# Decision: Multi-provider answer generation and encrypted key storage

**Status:** Accepted for the single-user, loopback-only product boundary  
**Date:** 2026-10-29  
**Migration:** `003_ai_provider_settings.sql`

**Evolution note (2026-10-30):** The provider/key boundary remains current. The original choice to use Ollama for embeddings was superseded by [local PostgreSQL full-text retrieval](local-postgres-full-text-retrieval.md); answer-provider selection no longer affects indexing or retrieval.

## Problem

VidScribe's RAG implementation was tied to Ollama for both embeddings and answer generation. Users need to choose a hosted model such as Gemini, OpenAI, or Claude, or keep generation local with Ollama. The change must preserve current indexes, attribute saved answers to the model that produced them, and avoid leaking user-supplied credentials.

## Naive approach

Read one provider API key from `.env`, branch on a string in the RAG service, and send every request through the selected SDK or endpoint. Alternatively, place a plaintext key in a browser setting or a database column.

## Why that is problematic

- A single environment variable makes provider choice a developer/deployment concern rather than a user preference.
- Provider conditionals in RAG mix retrieval/business logic with external HTTP formats and make adding a provider invasive.
- Reusing one provider setting for both embeddings and answer generation can make existing vectors incompatible after a model switch.
- Plaintext keys in a browser or database are exposed to unrelated application reads, browser extensions/XSS, logs, and database backups.
- Silent fallback can send private prompts to a different provider and create unexpected cost or data-transfer behavior.
- Keeping only the current provider setting makes historical answers impossible to attribute after later switches.

## Chosen approach

1. Add a small registry of named answer adapters for Gemini, OpenAI, Anthropic Claude, and Ollama. Gemini is the persisted default. The model ID can be edited per provider.
2. In the original implementation, keep transcript/query embeddings on Ollama and vectors in pgvector, separate from answer generation. This part was superseded by migration `004`, which makes vectors optional and uses PostgreSQL full-text search for current retrieval.
3. Persist provider configuration and a singleton active-provider choice in PostgreSQL. Record the provider and model ID on each completed assistant message.
4. Encrypt cloud keys in the backend with AES-256-GCM before saving. Store only ciphertext in `ai_provider_configs`; keep the 32-byte encryption key in the user's OS application-config directory outside the repository. Never return or log either key form.
5. Require a configured key before selecting a cloud provider. Do not fall back automatically if a key is missing, rejected, or provider unavailable.
6. Use fixed provider endpoints, non-streaming requests, a request timeout, response validation, and sanitized errors. Do not support user-defined base URLs in this phase.

## Why this is appropriate now

This provides the user-facing provider choice requested while adding only one adapter boundary and one settings resource. It leaves the stable retrieval/indexing pipeline alone, minimizes data migration, and makes answer history explainable. The current local-first, single-user loopback deployment allows a user-local encryption key without introducing an external key-management service prematurely.

## Example

Gemini remains selected after migration but has no user key yet, so the UI shows that configuration is required and disables question submission. The user can add a Gemini key and model, then ask a question. PostgreSQL searches the source's locally indexed transcript and sends the question plus matched excerpts to Gemini. The completed message stores `model_provider='gemini'` and the selected model ID. If the user switches to Ollama later, only future answer generation uses Ollama; local full-text retrieval stays the same.

## Failure scenario

- If Gemini is selected without a key, generation fails with a stable configuration error before any remote request.
- If Gemini rejects the key or times out, the user question remains in conversation history and the assistant message records a safe retryable failure. No request is sent to OpenAI or Ollama as a fallback.
- If the database is copied without the local encryption-key file, ciphertext remains unreadable. The user re-enters provider keys; restoring the old key file restores decryptability.
- If the model returns an invalid body, VidScribe rejects it rather than persisting malformed text.
- If model generation succeeds but answer persistence fails, the existing answer lease may cause inference to repeat after expiry. The durable message has one fenced owner, but external model execution is at-least-once and may be billed more than once.

## Concurrency scenario

Two tabs may save provider settings at once; current behavior is a single-row/one-provider upsert with last-write-wins settings. An answer already in flight uses the provider/model it resolved at start, and the saved message records that actual provider/model. Changing the global active provider affects future generation lookups. The conversation fencing token still decides which request can commit the answer. The exclusive-create key-file operation prevents two first-run processes from persisting different encryption keys.

## Trade-offs

**Gains:** user-controlled answer provider, smaller RAG coupling, no embedding reindex on answer-model switch, durable provenance, encrypted-at-rest credentials, sanitized errors, no silent data-routing fallback.

**Costs:** the user must manage provider accounts and model IDs; a local key file must be preserved separately from a database backup; hosted prompts may incur charges and leave the local machine; API adapter formats must be maintained; a missing key is a blocking configuration state. Keys can currently be replaced but not explicitly removed.

## Alternatives considered

- **Provider key only in environment variables:** simpler for deployment, but not suitable for in-app provider switching and separates configuration from the user's app settings.
- **Plaintext credential in PostgreSQL:** easier to inspect and restore, but database-only exposure reveals provider credentials.
- **OS keychain or cloud secret vault:** stronger platform/service lifecycle and rotation support, but adds platform libraries, operational setup, and deployment assumptions. Revisit if VidScribe becomes multi-user or hosted.
- **Support arbitrary OpenAI-compatible endpoint URLs:** broader compatibility, but user-controlled URLs create SSRF, DNS rebinding, redirect, and local-network access risks. Defer until outbound network controls exist.
- **Change embedding provider and answer provider together:** would couple indexing to answer preferences and could make stored vectors incompatible. Keep these settings separate.
- **Automatic failover:** could improve availability but sends question/source excerpts to a different service and may incur unanticipated cost. Explicit selection is safer for a user-managed local workspace.

## Interview explanation

"I separated answer generation from local retrieval so provider changes do not re-index source content. The current retrieval path uses PostgreSQL full-text search and keeps transcript indexing local; an answer adapter receives only matched excerpts and the question. Each adapter implements a provider-neutral contract, and keys are encrypted server-side with AES-GCM. We do not fail over silently because that changes where excerpts are sent and can create unexpected cost. Completed messages store provider/model provenance so later settings changes do not rewrite history."
