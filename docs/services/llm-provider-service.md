# LLM Provider Settings and Generation

**Implementation:** `backend/src/services/ai-settings.service.ts`, `backend/src/services/llm/llm.service.ts`, `backend/src/services/llm/provider-registry.ts`, `backend/src/services/llm/providers/`, `backend/src/repositories/ai-settings.repository.ts`, `backend/src/shared/secrets/`, and `frontend/src/components/AiSettingsPage.tsx`.

## Purpose

Let the user choose the model provider that writes answers while preserving a stable RAG contract. The currently supported answer providers are Gemini, OpenAI, Anthropic Claude, and optional local Ollama. Gemini is selected by default. Answer generation is independent of retrieval: PostgreSQL indexes and searches transcript text locally for every provider.

## Responsibilities

- Expose safe settings to the browser: provider ID/label, model ID, active/selected state, whether a provider is configured, and whether it requires a key.
- Validate model IDs and optional API keys at the HTTP boundary.
- Encrypt cloud API keys before persisting them; decrypt only in the backend immediately before use.
- Enforce that a key-required provider is configured before selecting it.
- Dispatch a grounded RAG prompt to the active adapter with a bounded request timeout.
- Return generated text, optional normalized token usage, and provider/model provenance for durable chat persistence.
- Map provider authentication, timeout, unavailable, rate-limit/request, and malformed-response failures to stable sanitized errors.
- Log successful provider latency and any provider-reported token counts as structured operational telemetry.

## Non-responsibilities

- Local transcript search, prompt retrieval, citation construction, or chat turn state. These are owned by the PostgreSQL retrieval repository, RAG, citation, and conversation services.
- Returning, logging, or placing API keys in browser storage.
- Silent fallback to a different provider when the selected provider fails or has no key.
- Arbitrary user-defined base URLs. The registry currently accepts vetted adapters only; custom URLs would need strict SSRF defenses.
- Streaming, automatic retry/backoff, provider billing controls, model catalog discovery, and key deletion. The UI currently supports key replacement and provider switching; these features can be added when there is a product requirement.

## Dependencies and boundaries

- `ai-settings.service` combines the provider registry, repository, and local secret-encryption key store for settings operations.
- `llm.service` reads the active provider and saved configuration, decrypts the key when needed, calls one adapter, and returns `{ text, provider, modelId }`.
- Provider adapters convert a common prompt/model/key/timeout input to provider-specific HTTP. Current APIs are Gemini `generateContent`, OpenAI Responses, Anthropic Messages, and Ollama chat.
- `ai-settings.repository` owns SQL for `ai_provider_configs` and the singleton `ai_runtime_settings` row. Secrets are ciphertext in PostgreSQL.
- `secret-cipher` uses AES-256-GCM. `local-key-store` keeps the 32-byte encryption key under the user's OS application-config directory, outside the source repository.
- `conversation.service` persists provider/model on a successfully generated assistant message. Its turn lease and transaction boundaries are independent of which adapter was selected.

Dependency direction remains: HTTP route/controller → AI settings application service or conversation/RAG service → provider registry/adapter and repositories. Provider-specific code never enters controllers or domain DTOs.

## API contract

- `GET /api/settings/ai`: returns the selected provider and safe configuration status/model for each supported provider. No key, plaintext or ciphertext, is returned.
- `POST /api/settings/ai/test-and-save`: tests a short generation request with the submitted/saved key and selected model; successful results atomically save the provider config and activate it. Failed tests leave prior settings intact. The test may incur usage.
- `GET /api/health`: reports PostgreSQL and the selected provider/model configuration. It does not make remote provider calls, avoiding surprise cost. Ollama is not a required health dependency.

The active provider is global because the current product boundary is a single-user local workspace. Introduce user/workspace-scoped settings only alongside identity and authorization; do not imply multi-user isolation with a global singleton.

## Supported providers and initial models

| Provider | Initial model ID             | Request boundary                  |
| -------- | ---------------------------- | --------------------------------- |
| Gemini   | `gemini-3.8-flash`           | Gemini `generateContent` REST API |
| OpenAI   | `gpt-6-luna`                 | OpenAI Responses API              |
| Claude   | `claude-sonnet-5-5`          | Anthropic Messages API            |
| Ollama   | Value of `OLLAMA_CHAT_MODEL` | Local Ollama chat API             |

Every model ID can be changed in AI settings. The API does not query vendor model catalogs, so a valid key does not guarantee that the selected model is available to that account. Check the current provider model catalog if a request reports an invalid model. Provider API request formats are documented in the [Gemini API reference](https://ai.google.dev/api), [OpenAI Responses API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create), and [Claude Messages API reference](https://platform.claude.com/docs/en/api/http).

## Generation flow

1. The conversation service commits a user message and a leased pending assistant message in a short transaction.
2. RAG retrieves source-scoped transcript excerpts with PostgreSQL full-text search.
3. If no excerpts pass the configured threshold, RAG returns the fixed insufficient-context response without calling an answer model.
4. Otherwise, RAG builds the grounded prompt and calls `llm.service`.
5. The LLM service resolves the active provider/model. If a required key is missing, it returns a safe configuration error rather than falling back.
6. The encrypted key is decrypted with the local key store; one provider adapter makes a non-streaming HTTP request under `AI_REQUEST_TIMEOUT_MS`.
7. The adapter validates the response shape and returns answer text plus normalized usage when the provider supplies it. `llm.service` logs provider latency and token counts with request, source, and turn IDs; provider/model provenance is returned to RAG and persisted with the answer and citations under the current turn fencing token.
8. A retryable safe failure is persisted on the assistant row; the original user question stays in history.

No PostgreSQL transaction is open while calling Ollama or a cloud provider. A provider switch affects new generation resolution; completed messages retain their provenance and content. Token usage is not persisted with messages, aggregated, or converted to currency. Missing usage metadata does not fail an otherwise valid answer.

## Credential lifecycle and security boundary

The browser submits a key over the same-origin local API and keeps it only in component memory until save succeeds. The frontend clears the input after save. The backend trims and validates the key, encrypts it with AES-256-GCM and a fresh nonce, then stores only ciphertext. The settings DTO exposes only `configured: true/false`. During generation, the backend loads the encrypted value, reads the local master key, decrypts in process memory, and sends the key in the provider's documented authentication header.

On Windows the key file is placed under `%LOCALAPPDATA%\\VidScribe`; on Linux/macOS it uses XDG or the standard macOS Application Support location. POSIX files are created mode `0600` in a `0700` directory. Windows uses the user's LocalAppData ACL. The database backup does not contain the key. Losing the key makes saved provider keys unusable, so the user must enter them again; preserving credentials across restore requires preserving this key file securely too. This is at-rest protection against database-only exposure, not protection against malware or another process running as the same user. The API currently binds to loopback and has no remote authentication/authorization boundary.

No key is intentionally included in application logs or provider failure messages. Provider error bodies are not surfaced to users because they can contain request details. Transcript indexing remains local. Cloud providers receive the user's question and retrieved transcript excerpts, and their usage may be billable to the user's account; the settings UI discloses this before use.

## Error handling

| Condition                                                | Behavior                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Provider not configured                                  | Refuse generation with a safe settings error; no fallback.                                                                     |
| Local encryption key missing/corrupt or decryption fails | Return `AI_PROVIDER_KEY_UNAVAILABLE`; ask the user to restore the local key or re-enter a provider key.                        |
| Provider returns 401/403                                 | Return a sanitized authentication failure and direct the user to replace the key.                                              |
| Provider returns 429                                     | Surface a rate-limit message and allow explicit retry where chat policy permits.                                               |
| Provider returns 5xx/network failure                     | Map to unavailable/request failure; preserve the user question and do not automatically retry.                                 |
| Request timeout                                          | Abort the HTTP call and return a stable timeout error.                                                                         |
| Malformed/empty response                                 | Return an invalid-response error; do not persist partial output.                                                               |
| Database save succeeds but UI response is lost           | Re-fetch settings; an optional key is not sent back, and a repeated save with no key preserves the stored credential.          |
| Generation succeeds but message completion commit fails  | Existing chat lease/idempotency rules can re-run model work after lease expiry; only the current generation token may publish. |

The provider adapters currently do not implement automatic retries or circuit breakers. This avoids multiplying billed requests and leaves retry semantics under explicit user control.

## Concurrency and transactions

Provider settings are global. The current test-and-save flow makes the provider request outside a transaction, then commits model/key and active-provider state together in one short transaction. Switching providers while an answer is running does not cancel it: that request has already resolved its provider/model and carries them back as provenance. A later answer resolves the then-current active provider. The turn fencing token remains the authority for whether an in-flight answer can be persisted. Simultaneous settings updates are last-write-wins; if multi-tab conflict handling becomes important, add a settings revision and optimistic concurrency check rather than broad locks.

Secret file creation uses exclusive create to coordinate concurrent first-use processes. A process-local promise avoids duplicate reads/writes within one backend process; competing processes retry reading the winning key file.

## Testing strategy

- Adapter unit tests mock `fetch` and assert exact auth headers, URL, request body, response extraction, normalized token usage, and that provider error bodies do not leak.
- Test timeout/abort, network failure, 401/403, 429, 5xx, and malformed/empty response behavior.
- Secret tests cover round-trip encryption, wrong key, ciphertext mutation, malformed format, and key length.
- Settings/service tests cover Gemini default, missing-key rejection, key replacement, selecting a configured provider, and a safe DTO with no key fields.
- PostgreSQL integration tests apply migration 003, switch provider, verify provenance persistence, and restore singleton state after each test.
- Browser smoke checks verify that keys are masked/cleared, configured status is visible without returning the secret, Gemini starts selected, and switching to Ollama works.
- Never use real provider keys or billable calls in the normal test suite. One opt-in manual smoke can be performed by the user after setting their own key/model.

## Future evolution

Add a new named adapter by implementing the provider-neutral generation input/output, registering its metadata and default model, validating its settings, and adding request/error tests. The current normalized usage logs are useful for a manual baseline, but they are not durable, request-correlated metrics or a billing ledger. Add usage persistence, pricing/versioned cost estimates, request correlation, provider-side streaming, per-user/workspace settings, key deletion, external secret-manager integration, rate limits, or circuit breakers only when product requirements and measured traffic justify them. Do not accept arbitrary URLs without destination allowlisting, DNS/IP rebinding protection, redirect restrictions, and outbound-network controls.

See the [usage telemetry decision](../decisions/provider-usage-telemetry.md) for why the current phase logs token counts without storing or pricing them.
