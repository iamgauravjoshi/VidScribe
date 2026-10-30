# Decision: Keep transcript retrieval local with PostgreSQL full-text search

**Status:** Accepted for the current local-first product boundary  
**Date:** 2026-10-30  
**Migration:** `004_postgres_full_text_search.sql`

## Problem

The existing source ingestion and question paths required Ollama embeddings, but the user does not want to install Ollama and wants Gemini for answers. Using Gemini embeddings would eliminate Ollama but would also transmit every full transcript to Google during indexing. The product needs a no-Ollama path that keeps transcript indexing local while still returning timestamped evidence for RAG.

## Naive approaches

- Send each transcript chunk to Gemini's embedding API, store its vector, and embed each question with the same model.
- Keep Ollama as a required dependency for local vectors even though the user does not want to install it.
- Query every chunk with `ILIKE '%term%'`, or load all source chunks into Node and search them there.

## Why those approaches are problematic

- Gemini embeddings improve semantic recall, but transmit the complete transcript at indexing time and may create separate billable embedding usage. This is a distinct data flow from sending only matched excerpts for an answer and needs explicit consent.
- Requiring local Ollama blocks this user’s requested workflow and adds a model download/runtime dependency for indexing and every question.
- `ILIKE` generally cannot use a term-aware full-text index well, handles English word forms poorly, and application-side scans consume memory and scale with transcript size.
- Removing the vector column immediately would destroy data and make a future semantic option harder to introduce deliberately.

## Chosen approach

Use PostgreSQL English full-text search for transcript indexing and query retrieval:

1. Migration `004` adds a GIN expression index over `to_tsvector('english', content)` and makes the existing vector column nullable.
2. New ingestion writes chunk text and timestamps only. PostgreSQL maintains GIN entries as part of the same transaction that publishes the complete chunk set and source `READY` state.
3. Query retrieval converts the question with `plainto_tsquery('english', ...)`, broadens generated terms to OR matching, filters by `source_id`, and orders by `ts_rank_cd` with chunk index as a tie-breaker.
4. No matching terms returns the fixed insufficient-context answer without calling Gemini.
5. Existing vectors and the pgvector extension remain untouched for migration/data compatibility; current retrieval does not use them.
6. The AI settings UI explains that transcript indexing stays local. Gemini receives only the question and matching excerpts during answer generation.

## Why this is appropriate now

It removes local runtime requirements and avoids a cloud transcript upload while adding no second service. PostgreSQL is already the system of record, and the corpus is currently local and small. It gives up semantic retrieval quality knowingly; an FTS search can return only words that match normalized transcript terms. We can measure real question quality before selecting a future semantic strategy.

## Example

The worker fetches an English transcript, chunks it with timestamps, then replaces the source's rows in one transaction. GIN index entries are maintained while those rows insert. A question such as “What makes the method effective?” is tokenized locally and searched only against that source. The top matched excerpts and question go to Gemini for an answer; the full transcript and embedding payload do not.

## Failure scenario

- If captions are unavailable, ingestion fails before persistence and the source exposes its safe failure state.
- If the search query has only English stopwords or PostgreSQL fails, no provider call is made; a zero-hit query returns insufficient context, while a database error is stored as a retryable answer failure.
- If an insert or GIN update fails in the publication transaction, the old chunk set stays committed and the source does not become `READY` with a partial new index.
- If Gemini fails after retrieval, the question and retryable assistant state remain persisted; retry repeats local retrieval and makes a new provider request only after explicit retry.

## Concurrency scenario

Workers still claim jobs with `SKIP LOCKED` and a fencing token. If a lease expires, a stale worker can finish chunking, but its final publication cannot commit. During a valid replace-all transaction, a reader sees either the previously committed chunks or the complete replacement due to PostgreSQL MVCC. The GIN index entries commit or roll back with the rows. Concurrent questions for different sources are restricted by `source_id` in SQL.

## Trade-offs

- **Gain:** no Ollama requirement for ingestion or questions, no full-transcript cloud indexing request, one local database/index, and atomic text/index publication.
- **Cost:** no semantic understanding of synonyms or paraphrases without overlapping words; English stemming/stopword behavior is language-specific; ranking is not calibrated as a probability.
- **Compatibility:** historical vectors remain stored but are unused. Existing text chunks are indexed by the new expression index without needing a full transcript refetch.
- **Operations:** building the GIN index in a migration scans the current table. For a large hosted corpus, use an online index-build plan rather than copying this initial local migration unchanged.

## Alternatives considered

- **Gemini embeddings:** better semantic recall and no local runtime; rejected for this phase because indexing would transmit the full transcript and require a separate data-consent and embedding-usage decision.
- **Ollama embeddings:** keeps transcripts local and semantic search; rejected for the user's current setup because they do not want to install Ollama.
- **SQL `ILIKE`/substring scan:** easy, but weak ranking/stemming and poor index behavior at growth. Not chosen as the durable retrieval contract.
- **Hybrid FTS + vectors:** could combine term precision with semantic recall, but would still need an embedding provider, index/version metadata, and a clear transfer policy. Defer until retrieval evaluation supports it.
- **External search service:** unnecessary infrastructure while PostgreSQL handles both durable data and local full-text indexing.

## Interview explanation

“I chose PostgreSQL full-text search because the user needed Gemini answers without installing Ollama and wanted transcripts to remain local. Gemini embeddings would have sent each full transcript to Google during indexing, so I kept the cloud boundary limited to the question and the excerpts selected locally. PostgreSQL's GIN index provides source-scoped, ranked lexical retrieval and updates atomically with chunk publication. The trade-off is weaker recall for synonyms and paraphrases; I would add a semantic or hybrid strategy only after retrieval evaluation and an explicit data-transfer choice.”

## References

- [PostgreSQL full-text search](https://www.postgresql.org/docs/current/textsearch.html)
- [PostgreSQL GIN indexes](https://www.postgresql.org/docs/current/gin.html)
- [Full-text search service guide](../services/postgres-full-text-search.md)
- [Evolution history](../architecture/evolution.md)
