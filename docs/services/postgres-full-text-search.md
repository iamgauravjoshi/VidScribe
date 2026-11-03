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
3. For a question, the repository creates an OR query for broad candidate matching, an all-terms query, and an ordered phrase query. The question remains a bound SQL parameter.
4. The GIN-indexed chunk search filters by source ID and ranks matches with `ts_rank_cd`. It materializes the original top-K chunk candidates before any reranking, preserving the candidate set and its recall ceiling.
5. For each candidate chunk, a lateral lookup finds the best matching canonical transcript segment whose start falls inside that chunk's time range. Segment ordering favors phrase match, then all-question-terms match, then length-normalized cover-density rank, then earlier segment position. The candidate chunks are reranked using segment/chunk phrase match, full-query match, length-normalized segment or chunk relevance, original chunk relevance, and chunk index as deterministic tie-breaks. Using the same normalization for the segment and fallback chunk score keeps the comparison on a consistent rank scale.
6. RAG still sends complete selected chunks as context. Citation mapping points to the selected transcript segment's start/end and excerpt, then deduplicates repeated segments caused by overlapping chunks. Sources without canonical transcript segments fall back to the chunk's timestamp and text.

The current transcripts are English, so the English text configuration applies stemming and drops stopwords. A question containing no searchable terms returns zero matches. FTS scores are ranking signals, not probabilities and not comparable to the cosine similarity used by the historical vector path. Reranking does not expand beyond the original top-K candidate set; it improves ordering and selects a more precise citation only among those candidates.

## Schema compatibility

Migration `004` makes the old `embedding` column nullable and adds an expression GIN index. It does not remove, rewrite, or transmit existing vector values. New FTS-only chunks store `NULL`; old chunks remain searchable by their text. The pgvector extension and column remain only to preserve existing databases and provide a possible future migration path.

## Failure, concurrency, and transactions

If the search query fails, the assistant turn records a safe retryable failure. A no-hit query is a normal result and does not call the LLM. During reindex, PostgreSQL MVCC and the existing write transaction expose either the old committed chunks or the complete new chunk set; index maintenance commits or rolls back with the chunk rows and source `READY` state.

The current migration creates the GIN index in a transaction and is suitable for the present local dataset. A hosted service with a large existing chunk table should plan index creation with an online migration strategy and maintenance window.

## Testing strategy

Use the isolated PostgreSQL integration database, not mocks, to verify the actual `tsvector`/`tsquery` semantics and GIN expression. Cover stemming, OR matching, no searchable terms, source isolation, rank ordering, a phrase-match versus repeated-term decoy, precise segment selection, legacy chunk-only fallback, citation deduplication, and behavior when new chunks have no embedding. The versioned synthetic fixture asserts its `Recall@3` baseline of 0.75, including one deliberate lexical paraphrase miss. The provider-free real-source evaluation has a paired six-query reranking comparison plus dataset v2 with 18 human-labeled question-to-segment cases across six videos. It reports evidence Recall@1/3/5 separately from exact labeled-segment citation@1/3/5, citation-offset percentiles, and results by query style/source topic. Exact segment identity is a strict audit signal, not a complete semantic-support or answer-correctness judgment. See the [evaluation report](../evaluations/real-source-search-2026-11-03.md).

These are deterministic SQL/retrieval/citation regression checks plus a small provider-free real-transcript sample. They do not establish generated-answer correctness, cross-language behavior, or production search quality. Keep expected evidence human-labeled and expand the corpus before changing the candidate strategy or adding semantic retrieval.

## Future evolution

Add language metadata before indexing non-English text. Expand the labeled evaluation corpus and collect user feedback before changing ranking. Hybrid semantic search can be added later as a separate strategy with model/version metadata and an explicit transcript transfer policy; it should not silently replace local FTS.
