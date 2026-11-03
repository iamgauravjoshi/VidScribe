# Decision: Rerank transcript evidence and cite matching segments

**Status:** Accepted for the current PostgreSQL retrieval path
**Date:** 2026-11-03
**Schema change:** None

## Problem

Retrieval returned broad overlapping chunks and cited each chunk's beginning. A chunk can contain the answer several sentences after its start, so citations required readers to scan a long passage or seek away from the supporting moment. The first real-source evaluation also showed relevant evidence at ranks 2–5 even when it was already present in the top five.

## Naive approach

- Reduce chunk size until every chunk is close to a sentence.
- Replace local PostgreSQL search with embeddings or a hosted search service.
- Rerank the complete transcript or all matching segments for every question.
- Keep the existing ranked chunk but simply point its citation to the first segment.

## Why those approaches are problematic

- Smaller chunks require reprocessing every source, change the answer context window, and can split useful adjacent context. They do not by themselves improve lexical ranking.
- Cloud embeddings would change the transcript privacy and cost boundary; a new local vector runtime adds deployment complexity before the measured sample shows semantic search is required.
- Ranking every segment changes candidate semantics, increases per-question work, and makes comparison with the existing top-K baseline harder.
- The chunk's first caption may not contain the matching terms or support the answer, so it can remain a misleading citation.

## Chosen approach

Keep chunk retrieval as the candidate-generation and RAG-context boundary. In one PostgreSQL statement:

1. Build an OR query for broad matching, an all-query-terms query, and a phrase query from the bound question parameter.
2. Rank matching chunks by the existing indexed PostgreSQL English full-text path and materialize the original configured top-K set.
3. For each selected chunk, use a lateral lookup to select a matching canonical transcript segment whose start time falls inside the chunk range. Prefer phrase matches, then all-term matches, then length-normalized cover-density rank, then the earlier segment.
4. Rerank only the existing candidate chunks by segment/chunk phrase match, segment/chunk full-query match, length-normalized segment relevance or length-normalized chunk fallback relevance, original chunk relevance, then chunk index. The segment and fallback scores use the same length normalization so the fallback does not switch to a different score scale.
5. Continue passing each full chunk to the answer provider. Build citation excerpt, start/end time, and YouTube seek URL from the selected segment. Deduplicate citations that point to the same segment through overlapping chunks.
6. If canonical segments are absent, return the chunk as before. No migration or transcript refresh is needed.

The original top-K candidate set is preserved, so segment reranking can reorder those candidates but cannot introduce a candidate outside that set. This keeps the comparison bounded and preserves the baseline's Recall@5 on the measured six-query sample.

## Why this is appropriate now

Transcript segments and their time index already exist in PostgreSQL. This design improves citation precision without a second index, remote transcript transfer, reingestion, or a new runtime. It reuses chunk overlap to preserve context for answer generation while treating the canonical caption segment as the narrower evidence pointer shown to users.

On the paired three-source, six-query sample, Recall@5 stayed 1.00, MRR improved from 0.547 to 0.672, and the median absolute distance from the labeled anchor to citation start fell from 58.44 seconds to 15.57 seconds. These results are diagnostic only; they do not establish answer factuality or generalize to a broad source set.

## Example

A chunk covers 12–45 seconds, while the question's supporting caption appears at 30–45 seconds. RAG receives the complete 12–45 second chunk for context. The answer cites the exact 30–45 second caption and creates a YouTube URL with `t=30s`. If an overlapping chunk selects that same caption, only one citation is returned.

## Failure scenario

- If no segment matches the broad query inside a chunk, citation mapping falls back to that chunk's original text and range.
- If a source has chunks but no canonical transcript rows (legacy data), the `LEFT JOIN LATERAL` preserves the chunk and produces the same fallback.
- If the database statement fails, the answer flow records a retrieval failure; it does not send a partial candidate set to a provider.
- If a chosen caption is present but its wording is only weakly related, lexical ranking can still choose a poor segment. This is a ranking limitation; the sample does not prove semantic support.

## Concurrency scenario

Candidate selection, segment lookup, and reranking occur in one read statement, so PostgreSQL evaluates them against one statement snapshot. During atomic transcript publication, the query sees the prior committed chunk/segment set or the newly committed set, not a mixture. Concurrent questions have no mutable shared reranking state. Citation deduplication is per response and uses source ID plus canonical segment index.

## Trade-offs

- **Gain:** citations seek closer to the matching caption; overlapping chunks do not produce duplicate evidence citations; no migration or external indexing service; full answer context remains intact.
- **Cost:** SQL does additional segment lookups for at most top-K chunks. The first query shape uses an indexed source/time segment range and is appropriate for the current local corpus; query plans should be measured as transcript volume grows.
- **Bound:** the design only reranks the initial chunk top-K set. It cannot rescue a relevant chunk omitted by candidate generation, and lexical matching still misses synonyms and paraphrases.
- **Metric caveat:** MRR/recall use six human-labeled evidence anchors. Timestamp distance measures the citation start's absolute distance from the anchor, not whether the generated answer is fully supported or whether a person prefers the seek point.
- **Fallback:** legacy chunk-only rows retain their previous citation behavior until a later refresh produces canonical segments.

## Alternatives

- **Smaller chunks:** defer; changes RAG context and forces a full reindex before proving it is needed.
- **Segment-only RAG context:** rejected for now; sentences can lose surrounding explanation that supports a coherent answer.
- **Semantic/vector reranking:** defer until a larger labeled set shows lexical misses; it also requires a model/index version and explicit transcript transfer policy.
- **Rerank more than top-K:** defer; increases work and changes candidate-recall comparisons. Revisit if expanded evaluation shows relevant evidence is omitted before the reranker.
- **External search engine:** unnecessary for the current local corpus and PostgreSQL system of record.

## Interview explanation

“I kept retrieval context and citation precision as separate concerns. PostgreSQL first selects the same top-K overlapping chunks as before, so the answer retains useful surrounding context and we can compare ranking without changing candidate recall. A segment lookup then prefers the caption that matches the phrase or all query terms, and the UI cites that caption's exact time. Because the selection happens in one statement and canonical transcript rows are published atomically, the chunk and caption evidence come from one consistent snapshot. The trade-off is that reranking cannot find evidence excluded from the original top-K; I would revisit candidate generation only if a larger labeled evaluation shows that is a real failure.”

## References

- [Evaluation report](../evaluations/real-source-search-2026-11-03.md)
- [PostgreSQL full-text search service](../services/postgres-full-text-search.md)
- [Retrieval and RAG service](../services/retrieval-rag-service.md)
- [PostgreSQL text search controls and ranking](https://www.postgresql.org/docs/18/textsearch-controls.html)
- [Architecture evolution log](../architecture/evolution.md)
