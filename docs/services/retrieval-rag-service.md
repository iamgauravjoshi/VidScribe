# Retrieval and RAG Service

**Implementation:** `backend/src/services/rag/rag.service.ts`, `backend/src/services/rag/citation.service.ts`, `backend/src/repositories/retrieval.repository.ts`, and `backend/src/services/llm/llm.service.ts`.

## Purpose and responsibilities

The RAG workflow answers a question about one ready source using transcript passages retrieved from the local PostgreSQL full-text index. It coordinates retrieval, grounded prompt construction, answer generation, and citation mapping.

The retrieval repository owns PostgreSQL query/index details. RAG owns orchestration and prompt assembly. `llm.service` routes answer generation to Gemini, OpenAI, Claude, or optional Ollama. Citation mapping converts matched chunks to timestamped source links. The chat service owns durable turn state and transaction boundaries.

## Input and output

- Input: source ID and validated question string.
- Output: answer text, citations, and provider/model provenance; provider/model are null when no transcript terms match and the fixed insufficient-context response is returned without an LLM call.
- A citation contains a chunk ID, timestamp range, excerpt, and YouTube timestamp URL.

## Execution flow

1. The chat service has already committed the user turn and pending assistant placeholder.
2. `retrieval.repository` tokenizes the question with PostgreSQL `plainto_tsquery('english', ...)`, broadens the generated terms to OR matching, and ranks matching chunks with `ts_rank_cd`.
3. SQL filters by `source_id`, returns at most configured `topK` results, and orders by rank then chunk index for deterministic ties.
4. With no hits, RAG returns an insufficient-context answer without calling Gemini or another answer provider.
5. Otherwise, RAG builds a prompt from the question and matched excerpts, asks the configured provider, and maps those same excerpts to citations.
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

The disposable PostgreSQL integration test verifies nullable-vector inserts, English stemming/matching, positive ranks, stopword-only no-match, source isolation, atomic replacement, and the four-case labeled `Recall@3` baseline. It also checks timestamp citations map to the exact retrieved source chunks. Provider calls are not needed to test retrieval; keep retrieval quality cases deterministic and provider-free before tuning OR matching, ranking, chunk size, or a future semantic fallback.

## Future evolution

Full-text matching is appropriate for a local single-user transcript library but misses synonyms and paraphrases without overlapping terms. Consider a hybrid FTS/vector strategy only after measuring answer quality and latency. Any embedding path must preserve the user's transcript privacy choice, identify the embedding model per index generation, and use matching query vectors. Search languages should become source metadata before adding non-English inputs.

See [PostgreSQL full-text search](postgres-full-text-search.md), [local retrieval decision](../decisions/local-postgres-full-text-retrieval.md), and the [provider service](llm-provider-service.md).
