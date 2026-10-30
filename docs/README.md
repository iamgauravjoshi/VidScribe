# VidScribe Documentation

- [Project guide](PROJECT.md): product boundary, architecture, API, data model, local setup, and current limits.
- [Product boundary](product/product-boundary.md): target user, v1 scope, non-goals, and acceptance criteria.
- [Library and source workspace UX map](product/library-and-source-workspace.md): page and state behavior, including current implementation status.
- [AI provider settings](product/ai-provider-settings.md): provider selection, key setup, privacy, states, and current limits.
- [System overview](architecture/system-overview.md): component responsibilities, data flow, states, and failure recovery.
- [Evolution log](architecture/evolution.md): dated architecture changes and deferred work.
- [Source library API](services/source-library-api.md), [chat conversation service](services/chat-conversation-service.md), [request context middleware](services/request-context.md), [LLM provider service](services/llm-provider-service.md), [ingestion worker](services/ingestion-service.md), [PostgreSQL full-text search](services/postgres-full-text-search.md), and [retrieval/RAG](services/retrieval-rag-service.md): implementation contracts and operations.
- `cd backend && npm test`: unit tests plus an optional PostgreSQL integration test. Set `VIDSCRIBE_TEST_DATABASE_URL` to a disposable empty database with `test` in its name to enable the integration case.
- A dedicated disposable PostgreSQL target is available via the repository-root `docker-compose.test.yml`; its start, test, and reset commands are in the root README.
- [Decisions](decisions/): why important boundaries and state mechanisms were selected, including [persisted conversations and idempotent turns](decisions/persisted-conversations-and-idempotent-turns.md), [multi-provider generation/key storage](decisions/multi-provider-generation-and-key-storage.md), [provider usage telemetry without a billing ledger](decisions/provider-usage-telemetry.md), [local PostgreSQL full-text retrieval](decisions/local-postgres-full-text-retrieval.md), and [chat observability/retrieval evaluation](decisions/chat-observability-and-retrieval-evaluation.md).
- [Interview reference](interview/engineering-concepts.md): concise and deep explanations of current engineering decisions.
