# Optional Ollama Answer Provider

**Implementation:** `backend/src/shared/ollama/ollama.client.ts` and `backend/src/services/llm/ollama.service.ts`.

## Purpose and boundary

Ollama is an optional local adapter when a user chooses a local answer model. It is not required for source ingestion, transcript indexing, retrieval, Gemini answers, or PostgreSQL health.

The shared client owns `/api/chat` transport, timeout, response validation, and sanitized errors. The service maps the response into the provider-neutral answer result and optional token usage. The LLM registry exposes Ollama alongside Gemini, OpenAI, and Claude.

## Dependencies and flow

- Input: a prompt, selected local chat model ID, and timeout.
- Output: generated text and any token counts present in the response.
- External dependency: Ollama must be installed and the selected model already available if Ollama is active.
- The answer provider receives the question and retrieved transcript excerpts. Search itself has already completed locally in PostgreSQL.

## Failure and concurrency

Timeouts map to a stable timeout error; network failures map to unavailable; non-2xx or malformed responses map to a generation failure. There are no automatic retries, application concurrency limits, or streaming responses. Calls are stateless and may overlap; if the provider fails, the same persisted chat turn can be retried explicitly.

## Data and testing

No transcript is transmitted to Ollama for indexing. Provider adapter tests mock the transport and verify request/response handling, usage parsing, and sanitized failures. An opt-in manual check can verify a user's local model; normal tests do not require Ollama.

## Future evolution

If local generation is used under load, measure queue time/latency before adding a bounded semaphore or background queue. Keep Ollama-specific request fields inside the adapter. Embeddings were removed from the V1 indexing path by the [local PostgreSQL full-text retrieval decision](../decisions/local-postgres-full-text-retrieval.md).
