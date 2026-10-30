# VidScribe Product Boundary

**Status:** Working v1 product decision, 2026-10-30  
**Release target:** Local-first, single-user web application

This document defines what VidScribe is trying to be in its first useful release. It separates the desired product from the capabilities currently implemented in the repository.

## Implementation checkpoint — 2026-10-30

The current vertical slice implements the library, durable source/job processing, retry/removal, PostgreSQL full-text retrieval, Gemini/OpenAI/Claude answer providers, timestamp citations, and one persisted conversation per source. Each answer turn has durable status and safe failure/retry metadata. Transcript indexing stays on the local PostgreSQL instance and does not require Ollama. The product boundary below remains the target; multi-user access, additional source adapters, retrieval evaluation, and background chat workers remain future work.

## Product statement

VidScribe helps an individual understand and revisit long educational videos by answering questions with evidence linked to the relevant moment in the video.

VidScribe is a personal research and learning workspace. The core value is not “chat with an AI”; it is **get a useful answer and be able to inspect where the answer came from**.

## Primary user and job

### Primary user

A self-directed learner, researcher, or knowledge worker who regularly watches long-form educational YouTube videos and wants to retrieve ideas from them later.

### Job to be done

> When a long video contains something I want to understand or remember, help me ask a specific question, get a concise answer grounded in the video, and jump to the supporting moment without searching through the whole recording again.

## V1 boundary

### Included

- One local user and one local library. No account creation is needed to use the first release.
- YouTube URLs as the only supported input source.
- Public videos with an English transcript/captions available through the current transcript integration.
- A persistent library where the user can find, reopen, retry, and remove sources.
- Clear processing states and useful failure messages. Ingestion should not require the browser to remain blocked until all model work finishes.
- Questions scoped to one selected source at a time.
- Answers grounded in retrieved transcript text, with clickable timestamp citations that open the YouTube video at the cited moment.
- One persistent conversation per source in the first UI, with messages that survive a page refresh and application restart. Multiple named conversations per source are deferred.
- Local PostgreSQL full-text persistence/search and an explicit choice of Gemini, OpenAI, Claude, or optional Ollama for answer generation. Gemini is the default selection and must be configured by the user before it can generate answers.
- A setup and dependency-health experience that tells the user when PostgreSQL or the selected answer provider is unavailable or unconfigured.

### Explicitly out of scope for V1

- Multi-user accounts, teams, sharing, invitations, roles, or workspace administration.
- Hosted SaaS operation, cloud sync, or cloud storage.
- PDF, web-page, podcast, audio-file, and video-file imports.
- Downloading video/audio or generating transcripts with speech recognition when captions are unavailable.
- Cross-source questions, global semantic search, and organization-wide knowledge bases.
- Mobile native applications, browser extensions, public links, and social features.
- Additional unvetted LLM vendors, arbitrary model API endpoints, agents, autonomous browsing, or model fine-tuning.
- RabbitMQ or a separate vector database before measured product needs justify operating them.

These are deferred product options, not commitments. A second source should be selected based on a real user need and implemented through a small adapter boundary. V1 should not ship a generic plugin system.

## Core user journey

1. The user opens VidScribe and sees the library, an empty-state explanation, and a clear action to add a YouTube URL.
2. VidScribe validates the URL and reports that the source was accepted.
3. The source appears in the library immediately with a visible state: queued, processing, ready, or failed. Failure includes a reason and a retry action where retry is safe.
4. When ready, the user opens the source workspace and asks a question about that source.
5. VidScribe returns an answer with citations. Selecting a citation opens the source video at the relevant timestamp.
6. The conversation and source remain available after a refresh or restart. The user can remove the source and its derived data.

## Product principles

1. **Evidence is part of the answer.** A fluent answer without inspectable source evidence is incomplete.
2. **Be honest about missing context.** If retrieval does not find useful evidence, say so rather than inventing a confident answer.
3. **Make long work visible.** The user can see whether ingestion is queued, running, ready, or failed and can recover from ordinary failures.
4. **Make saved work findable.** Sources and conversations are durable; refreshing the browser should not erase them.
5. **Keep the first setup understandable.** Dependency checks should explain what is missing and what to do next.
6. **Keep product language source-oriented.** YouTube is the first adapter, not the name of the whole product.

## Local-first boundary and privacy wording

For V1, the database, transcript indexing, and full-text retrieval run on the user's machine. Answer generation is user-configurable: Ollama keeps that step local, while Gemini, OpenAI, and Claude send the user's question and retrieved transcript excerpts to the selected provider and may incur charges under the user's account. Gemini is selected by default but cannot be used until the user saves a key. Provider choice is explicit and VidScribe never fails over silently.

Local-first does not mean every network interaction is local: importing a YouTube source contacts YouTube or the configured transcript provider to obtain captions, and a configured cloud answer provider receives the question plus retrieved excerpts. Product copy must identify the selected provider and explain that data flow before hosted generation is used. A future hosted deployment still needs a separate identity, authorization, retention, and data-residency contract.

## V1 acceptance criteria

V1 is useful when a new user can complete these tasks without losing work or guessing what the application is doing:

- Add a supported YouTube URL and distinguish invalid URLs from unavailable transcripts.
- See an accepted source in the library while ingestion continues, then see it become ready or failed.
- Retry an eligible failure without creating duplicate sources or duplicate searchable chunks.
- Refresh or restart and still find a ready source and its prior conversation.
- Ask a question and receive an answer whose timestamp citation opens the relevant part of the video.
- Add a provider API key, select an answer provider, and use its configured model without changing the local indexing/retrieval pipeline; Gemini is selected by default and missing-key state is clear.
- Receive a clear “not enough evidence” response when no useful transcript passage is retrieved.
- Remove a source and confirm its transcript chunks and conversations are removed according to the documented retention behavior.
- Get an actionable message if PostgreSQL is unavailable or the selected answer provider is unconfigured/unavailable.

These are product acceptance criteria. Business metrics such as retention or answer quality thresholds should be set after observing real user sessions rather than inventing numbers now.

## Important product and architecture consequences

- A persistent library requires list/detail/delete API operations and a reproducible schema, not just a process endpoint.
- Visible long-running ingestion requires durable job state and a worker or equivalent asynchronous execution mechanism. A PostgreSQL-backed queue is the first option to evaluate because PostgreSQL is already required; RabbitMQ is not a V1 requirement.
- A worker that may retry must have database-enforced uniqueness/idempotency for its outputs and a documented claim/recovery policy.
- A conversation should belong to a source in V1. Cross-source retrieval and workspace ownership are outside the initial boundary.
- Use “source” in the UI, API, and persistence model. YouTube fetching and URL parsing remain behind the first adapter. The `(source_type, external_id)` identity leaves room for a second input without creating a broad plugin system.
- The current implementation meets source lifecycle, local text search, citation, and conversation persistence paths, but does not provide multi-user ownership, a retrieval quality evaluation set, or operational metrics.

## Boundary review triggers

Revisit this decision when one of these becomes true:

- A user need requires a second source type.
- More than one person must use or share the same installation.
- Users need access away from the machine holding the local database.
- Users need semantic matching beyond word overlap, or local retrieval quality is insufficient.
- Actual ingestion volume or latency exceeds what a PostgreSQL-backed worker and GIN index can support.

## Next step

Apply migrations to a disposable PostgreSQL database, run the full-text integration tests, then verify that refresh, pending-answer recovery, failure retry, and citation display work in the browser. After the synchronous Gemini answer path is verified, measure latency/usage and decide whether to move generation into a durable background worker.
