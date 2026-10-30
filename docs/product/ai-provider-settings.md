# AI Provider Settings

## Purpose

Let a local VidScribe user choose the model provider that generates future answers for source conversations. Supported answer providers are Gemini, OpenAI, Claude, and Ollama. Gemini is the default selected provider; it needs a user key before the first answer can be generated.

## Requirements

- Show one provider selector and one shared editor for the provider's model and credential.
- Test provider connectivity before persisting changed settings; successful configuration becomes active for new answers.
- Let users save/replace cloud API keys without showing a saved key again.
- Allow selection only after required credentials have been configured.
- Identify which provider/model generated a completed answer.
- Explain that PostgreSQL indexes/searches transcript text locally and independently of the answer model.
- Tell the user that a cloud provider receives the question and retrieved transcript excerpts and may charge for usage.
- Keep chat usable when PostgreSQL and the selected answer provider are available; offer navigation to settings when the answer provider key is missing.

## User flow

1. A new database seeds Gemini as active. The library/source workspace displays a clear “configure Gemini” message, and the question composer remains disabled until its key is saved or another configured provider is selected.
2. In **Settings → AI model**, one provider is selected from Gemini, OpenAI, Claude, and Ollama. A shared model field and, for cloud providers, masked key field are shown.
3. **Test and save connection** sends a short prompt to that provider. A successful test saves the model and any replacement key, then activates the provider in one database transaction. The generated test text is discarded; only duration and normalized usage are logged.
4. The key input clears after success, and later settings reads show only configured status. Existing keys can be tested without re-entering them.
5. The active provider writes future answers. Previously completed messages retain answer text, citations, provider, and model.
6. **Settings → Appearance** offers light and dark themes. The header toggle changes the same setting; the browser-local preference persists across reloads.
7. PostgreSQL full-text search remains local for every answer provider. Selecting Ollama keeps generation on the user's machine. Selecting Gemini/OpenAI/Claude sends the question and matching source excerpts to that provider.

## Data and request flow

`AiSettingsPage` calls `GET /api/settings/ai` and `POST /api/settings/ai/test-and-save`. `ai-settings.service` validates configuration, resolves the API key, tests the model, and encrypts a replacement key before the repository atomically writes ciphertext/model to `ai_provider_configs` and the chosen provider to `ai_runtime_settings`. The singleton runtime row is seeded to Gemini. RAG retrieves with source-scoped PostgreSQL full-text search and dispatches answer generation through the selected adapter. The conversation repository stores provider/model provenance in `messages` with the completed answer.

## States and failures

| State | User-visible behavior |
| --- | --- |
| Gemini selected, key missing | Default label and setup warning; answer submission disabled; Configure AI action shown. |
| Cloud provider configured, not selected | Configured status without revealing the secret; selection enabled when there are no unsaved edits. |
| Model or key has unsaved edits | Save action enabled; selection disabled until saved to avoid a confusing config race. |
| Connection test in progress | Provider fields/actions disabled; repeated submissions are prevented. |
| Invalid/rejected key or model | Sanitized error with provider context; no settings are written, so the prior active configuration stays in use. |
| Test succeeds, database transaction fails | Provider usage may have occurred, but no model/key activation is committed; user can retry. |
| Provider timeout/rate limit/unavailable | Assistant turn remains in history with safe failure and retry state; no silent fallback. |
| PostgreSQL unavailable | Library, local search, and conversation operations report a database dependency error. |
| No matching transcript evidence | Fixed insufficient-context answer with no provider call and no model provenance. |

## Privacy and cost

API keys are not returned from the server or written into browser local/session storage. They are encrypted in PostgreSQL using AES-256-GCM with a per-user local key file outside the repository. The user must back up that encryption key separately if encrypted credentials need to survive a database restore. This at-rest design assumes the same operating-system user account is trusted.

For cloud providers, answer input includes the user's question and retrieved source excerpts. Transcript indexing and search use PostgreSQL locally; VidScribe does not send a full transcript to a cloud provider to build the index. Answer requests and the explicit connection test send provider input and may be billable under the user's account and subject to provider terms and retention controls. Reading health status never makes a remote provider request.

## Current limits

- Provider selection is global in the single-user local app; there is no user/workspace identity boundary.
- Model IDs are user-editable, but provider model catalogs are not fetched or validated before a call.
- Connection testing uses a short generation request rather than a model-list endpoint; this checks the selected model's ability to generate and may incur usage.
- Keys can be replaced but cannot yet be cleared through the UI.
- Only fixed vetted provider endpoints are accepted. Arbitrary endpoint URLs and compatible-hosted APIs are deferred until SSRF defenses are designed.
- Generation is non-streaming, synchronous, and has no automatic retry/backoff or usage/cost ledger.

## Relevant implementation

- UI: `frontend/src/components/AiSettingsPage.tsx`, `frontend/src/components/AppSidebar.tsx`, `frontend/src/App.tsx`.
- API and settings: `backend/src/routes/ai-settings.routes.ts`, `backend/src/controllers/ai-settings.controller.ts`, `backend/src/services/ai-settings.service.ts`.
- Runtime adapters: `backend/src/services/llm/`.
- Credential storage: `backend/src/shared/secrets/`, `backend/src/repositories/ai-settings.repository.ts`.
- Schema: `backend/migrations/003_ai_provider_settings.sql`.
- Design rationale: [multi-provider generation and key storage](../decisions/multi-provider-generation-and-key-storage.md).
