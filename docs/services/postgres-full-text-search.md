# PostgreSQL Full-Text Search

**Implementation:** `backend/src/repositories/retrieval.repository.ts`, `backend/src/repositories/chunk.repository.ts`, and migration `004_postgres_full_text_search.sql`.

## Purpose

Build and query a source-scoped transcript index locally without a model runtime or remote embedding request. This is the current retrieval mechanism for every answer provider.

## Responsibilities

- Store chunk content and timestamps in `source_chunks`.
- Maintain a GIN expression index over English `to_tsvector(content)`.
- Convert a validated question into PostgreSQL search terms and return ranked matches scoped to one source.
- Return ranks and source metadata needed by RAG and timestamp citations.

It does not call Gemini, generate embeddings, decide answer quality, construct prompts, or persist conversation state.

## Data and query flow

1. The worker fetches English captions and segments them into timestamped overlapping chunks.
2. In the final source-publication transaction, the repository inserts chunk text and nullable legacy vector data. PostgreSQL computes GIN entries as part of the insert.
3. For a question, the repository uses `plainto_tsquery('english', question)`. VidScribe changes the generated conjunctions into OR terms so natural-language questions can match a passage on some meaningful words. The input remains a bound parameter; it is not interpolated into SQL.
4. The query uses the same `to_tsvector('english', content)` expression as the GIN index, filters by source ID, ranks with `ts_rank_cd`, and breaks ties by chunk index.
5. RAG passes selected excerpts to the configured answer provider and maps the same rows to citations.

The current transcripts are English, so the English text configuration applies stemming and drops stopwords. A question containing no searchable terms returns zero matches. The score is an FTS rank, not a probability and not comparable to the cosine similarity used by the historical vector path.

## Schema compatibility

Migration `004` makes the old `embedding` column nullable and adds an expression GIN index. It does not remove, rewrite, or transmit existing vector values. New FTS-only chunks store `NULL`; old chunks remain searchable by their text. The pgvector extension and column remain only to preserve existing databases and provide a possible future migration path.

## Failure, concurrency, and transactions

If the search query fails, the assistant turn records a safe retryable failure. A no-hit query is a normal result and does not call the LLM. During reindex, PostgreSQL MVCC and the existing write transaction expose either the old committed chunks or the complete new chunk set; index maintenance commits or rolls back with the chunk rows and source `READY` state.

The current migration creates the GIN index in a transaction and is suitable for the present local dataset. A hosted service with a large existing chunk table should plan index creation with an online migration strategy and maintenance window.

## Testing strategy

Use the isolated PostgreSQL integration database, not mocks, to verify the actual `tsvector`/`tsquery` semantics and GIN expression. Cover stemming, OR matching, no searchable terms, source isolation, rank ordering, and behavior when new chunks have no embedding. A populated legacy fixture should confirm migration preserves old vectors while making their text searchable.

## Future evolution

Add language metadata before indexing non-English text. Add labeled retrieval evaluation and user feedback before changing ranking. Hybrid semantic search can be added later as a separate strategy with model/version metadata and an explicit transcript transfer policy; it should not silently replace local FTS.
