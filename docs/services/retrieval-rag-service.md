# Retrieval and RAG Service

**Implementation:** `backend/src/services/rag/rag.service.ts`, `backend/src/services/rag/citation.service.ts`, `backend/src/repositories/retrieval.repository.ts`, and `backend/src/services/llm/llm.service.ts`.

## Purpose and responsibilities

The RAG workflow answers a question about one ready source using transcript passages retrieved from the local PostgreSQL full-text index. It coordinates retrieval, grounded prompt construction, answer generation, and citation mapping.

The retrieval repository owns PostgreSQL query/index details. RAG owns orchestration and prompt assembly. `llm.service` routes answer generation to Gemini, OpenAI, Claude, or optional Ollama. Citation mapping converts matched chunks to timestamped source links. The chat service owns durable turn state and transaction boundaries.

## Input and output

- Input: source ID and validated question string.
- Output: answer text, citations, and provider/model provenance; provider/model are null when no transcript terms match and the fixed insufficient-context response is returned without an LLM call.
- A citation contains a chunk ID, the selected transcript-segment timestamp range and excerpt when available, and a YouTube timestamp URL. Legacy chunk-only sources use the wider chunk range and text.

## Execution flow

1. The chat service has already committed the user turn and pending assistant placeholder.
2. `retrieval.repository` creates OR, all-term, and phrase queries. PostgreSQL full-text search finds and ranks matching chunks within the source.
3. SQL freezes the original chunk-level top-K candidate set, then reranks only those candidates using chunk and best matching transcript-segment phrase/full-query signals, normalized segment rank, original chunk rank, and chunk index for deterministic ties.
4. With no hits, RAG returns an insufficient-context answer without calling Gemini or another answer provider.
5. Otherwise, RAG builds a prompt from the question and complete matched chunks, asks the configured provider, and maps each chunk to its best supporting transcript segment for the citation. Citations that point to the same segment through overlapping chunks are emitted once.
6. The conversation service persists the answer and citations under the current fencing token.

Transcript text and question search remain in PostgreSQL on the local machine. A cloud answer provider receives only the question and retrieved excerpts, which may be billable. No database transaction remains open during provider inference.

## Failure handling

- Stopword-only or punctuation-only questions produce no FTS terms and therefore no evidence; no provider call occurs.
- PostgreSQL query errors are recorded as a safe retryable answer failure; no partial citations are returned.
- A cloud provider failure leaves the question in history and records a safe assistant failure. The user can retry the same turn ID.
- If a provider succeeds but final message persistence fails, the existing lease can allow inference to repeat after expiry.

## Concurrency

Retrieval uses one read statement and requires no transaction beyond the statement snapshot. A simultaneous index replacement is published transactionally: a search sees the old committed chunk set or the complete new set, not a partially replaced set. Different source queries are scoped in SQL. There is no application semaphore; PostgreSQL connection pooling and provider-side capacity are the current bounds.

## Testing strategy

The disposable PostgreSQL integration test verifies nullable-vector inserts, English stemming/matching, positive ranks, stopword-only no-match, source isolation, atomic replacement, the four-case labeled `Recall@3` baseline, phrase-match ranking against a repeated-term decoy, precise segment citations, and chunk-only legacy fallback. Unit coverage verifies segment citation deduplication for overlapping chunks. Provider calls are not needed to test retrieval; keep ranking and citation checks deterministic and provider-free.

For product prioritization, the real-source evaluation runs the same PostgreSQL retrieval repository over up to three explicitly labeled public transcripts, with two questions per available source and a manually selected target segment for each question. It reports Recall@1/3/5, MRR, chunk-start distance, precise citation-start distance, segment citation availability, and URL integrity. The first paired comparison improved MRR from 0.547 to 0.672, preserved Recall@5 at 1.00, and reduced the median anchor-to-citation-start distance from 58.44 seconds to 15.57 seconds across the same six questions. It uses the real caption-ingestion path and no answer provider. This convenience sample does not measure answer factuality or represent the range of source lengths and speakers; see the [evaluation report](../evaluations/real-source-search-2026-11-03.md).

## Future evolution

Full-text matching is appropriate for a local single-user transcript library but misses synonyms and paraphrases without overlapping terms. Consider a hybrid FTS/vector strategy only after measuring answer quality and latency. Any embedding path must preserve the user's transcript privacy choice, identify the embedding model per index generation, and use matching query vectors. Search languages should become source metadata before adding non-English inputs.

See [PostgreSQL full-text search](postgres-full-text-search.md), [segment-aware ranking and citations decision](../decisions/segment-aware-reranking-and-citations.md), [local retrieval decision](../decisions/local-postgres-full-text-retrieval.md), and the [provider service](llm-provider-service.md).
