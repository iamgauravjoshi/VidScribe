# AI Provider Settings Service

## Purpose

Configure the model adapter used for future answers and verify a proposed provider/model/key before saving it.

## Responsibilities

- Read active provider/model configuration without returning ciphertext or plaintext credentials.
- Validate provider-specific configuration through the registered adapter boundary.
- Resolve a newly entered key or decrypt the existing saved key inside the backend process.
- Execute a short connection-test generation request and measure provider latency.
- After a successful test, atomically persist the selected provider's model/key and activate it.
- Log provider, model, duration, normalized usage, and safe error codes without logging request text or credentials.

## Non-responsibilities

- Fetching or maintaining provider model catalogs.
- Sending transcript content during settings checks.
- Persisting the generated test text or an answer message.
- Calculating monetary cost, providing a billing ledger, or retrying failed provider calls.
- Accepting arbitrary API base URLs. Named vetted adapters avoid turning a local settings feature into an SSRF-capable proxy.

## Dependencies and data flow

The React settings page calls `POST /api/settings/ai/test-and-save` with `{ providerId, modelId, apiKey? }`. The API validator constrains provider ID, model ID, and key size. `ai-settings.service` finds the adapter, resolves the key, and sends `Reply with exactly: VidScribe connection test successful.` to the chosen model. It discards the returned text. If a new key was supplied, it encrypts it before making the provider request so local key-store failures occur before billable work.

After provider success, one short PostgreSQL transaction upserts `ai_provider_configs` and `ai_runtime_settings`. If the provider call fails, neither row is changed. The endpoint returns safe settings and elapsed milliseconds only. Provider usage is included in structured logs but is not persisted.

Ollama uses the same flow without a key; the model must be present in the configured local Ollama runtime. Ollama's base URL remains an environment setting rather than a user-editable URL.

## Failure handling

- Invalid input is rejected before any network call.
- Missing/unreadable credentials fail before provider inference.
- Authentication, unsupported model, rate limit, timeout, and provider availability errors pass through sanitized provider errors; no configuration is written.
- If generation succeeds but the settings transaction fails, the provider may have charged for the test, but no model/key activation is committed. The user can retry.
- If a key was entered, the browser field clears only after the endpoint confirms persistence.

## Concurrency and transactions

Provider inference is outside a PostgreSQL transaction because remote calls can be slow and transactions should not hold locks while waiting on an external service. Configuration upsert and active-provider change share a single transaction, so the UI cannot report a selected provider while only half the settings are saved. Multiple tabs can still race; the last successful transaction wins. The app is currently single-user and has no optimistic version check for settings.

The test request itself is not idempotent at the provider: repeating it may incur repeated usage. The browser disables the action while a request is in progress, but a lost response followed by a retry can repeat the short test. The operation is safe for database state, not exactly-once for provider billing.

## Testing strategy

Exercise input validation, saved-key decrypt versus replacement-key use, no-write-on-provider-failure, atomic save-and-activate rollback, optional Ollama credential behavior, sanitized error propagation, and absence of keys/prompts/generated text in logs. Provider protocol tests should mock HTTP and assert the exact minimal request. A real account check belongs in a user-authorized manual smoke test because it may incur usage.

## Future evolution

When settings become multi-user, scope active providers and credentials by workspace/user and add version checks to avoid last-writer-wins tab races. If provider model listing endpoints are adopted, validate documented model capability per provider and retain a generation test option because a listed model may still be inaccessible to the account. Persist usage only after defining correlation, retention, and pricing semantics.

## Relevant files

- UI: `frontend/src/components/AiSettingsPage.tsx`, `frontend/src/App.tsx`, `frontend/src/App.css`, `frontend/src/index.css`.
- Route and validation: `backend/src/routes/ai-settings.routes.ts`, `backend/src/controllers/ai-settings.controller.ts`, `backend/src/validators/ai-settings.validator.ts`.
- Use case: `backend/src/services/ai-settings.service.ts`.
- Provider adapters: `backend/src/services/llm/provider-registry.ts`, `backend/src/services/llm/providers/`, `backend/src/services/llm/ollama.service.ts`.
- Persistence: `backend/src/repositories/ai-settings.repository.ts`.
- Decision: [test before saving and activation](../decisions/provider-test-before-save.md).
