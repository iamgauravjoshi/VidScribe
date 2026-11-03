# Repeatable Browser Suite Against an Isolated PostgreSQL Database

**Status:** Accepted — 2026-11-03

## Problem

The source evidence workspace had been checked manually. Manual runs did not preserve the same source/transcript rows or failure timing, so citation navigation, pagination, exports, and old-source refresh states could regress without a reliable repeatable check.

## Naive approach

Mock every API response in the browser, or point Playwright at the developer's regular application and database. A full mock would verify markup but miss PostgreSQL search, cursor behavior, real exports, API serialization, and status polling. Using the development database risks deleting or changing user data. Starting the real ingestion worker would make the tests depend on YouTube caption availability and introduce timing variability.

## Chosen approach

- Add `@playwright/test` at the repository root and make `npm run test:e2e` the single entry point.
- Start the repository's dedicated `vidscribe_test` Compose service on its assigned loopback port, apply migrations, and reset source rows only after validating the exact database name and loopback host.
- Start the real Express application composition without starting its ingestion worker, plus Vite on test-only ports `8218` and `4178`. Do not reuse existing servers.
- Seed realistic sources, chunks, conversations, citations, and transcript segments transactionally. For refresh tests, update the test database in transactions to model worker-recorded failure and publication outcomes.
- Use the real transcript API and PostgreSQL for transcript search, paging, exports, source polling, and refresh queue requests. Stub only the YouTube IFrame API to record a seek and emit a controlled embed error.
- Clean fixture sources after each test. Stop the test database container only if this runner started it; preserve its named volume.

## Why this is appropriate

VidScribe needs confidence at the seams between browser state, API contracts, and database-backed transcript behavior. The suite covers those seams without paying for or relying on a live provider. The existing backend PostgreSQL integration suite remains responsible for real worker repository behavior, lease fencing, atomic publication, and concurrency. Browser tests use one worker because fixtures share one isolated database and need controlled state progression.

## Example

For a legacy ready source with old search chunks but no canonical transcript, the browser first sees `NOT_AVAILABLE`. Clicking **Prepare transcript** calls the real API and the test verifies the durable refresh job is queued. The fixture then records a retryable failure, the browser receives it through its normal polling request, and retrying calls the real API again. The fixture publishes a transcript and completed job transactionally; the browser then displays the newly saved segment.

## Failure scenarios

- If Docker, migrations, the API, Vite, or Chromium cannot start, the suite fails with a nonzero exit code and attempts to stop the database container it owns.
- If a browser assertion fails, the source fixture is deleted by fixture teardown; Playwright retains failure screenshots/traces under ignored `test-results/` and `playwright-report/` directories.
- If the test database URL is absent, non-loopback, or not exactly `vidscribe_test`, the destructive source reset is rejected.
- If YouTube playback fails, the deterministic IFrame stub verifies that the local transcript and external YouTube fallback remain available. Live playback itself is not claimed.

## Concurrency scenario

Playwright browser cases run sequentially with one worker so test-owned rows cannot affect each other. This does not replace concurrent worker tests: PostgreSQL integration cases continue to exercise row locks, lease ownership, retry deduplication, and atomic publication against the actual job repository.

## Trade-offs

The suite starts a real database and browser, so it is slower and requires Docker Desktop plus a one-time Chromium install. It is more representative than a mocked component test for this workflow. The browser player is stubbed and no live YouTube or LLM call is made. State changes that represent worker outcomes are applied directly to the test database rather than invoking the worker's external caption adapter.

## Alternatives

- **Mocked API/component tests:** faster, but do not verify PostgreSQL FTS, pagination cursor, response formatting, or API/UI polling together.
- **Run the real ingestion worker:** tests more worker orchestration, but makes browser runs depend on captions and external YouTube availability; worker semantics already have focused PostgreSQL integration scenarios.
- **Use the development database:** simpler local setup, but unsafe and not reproducible.
- **Use a fresh database volume per run:** maximally isolated, but adds startup cost. The current test target retains its named volume and resets source data between runs.

## Interview explanation

“I use Playwright with a dedicated PostgreSQL database and the real local API, so the browser tests cover database-backed search, paging, export, and lifecycle polling. I leave the caption worker off and stub the YouTube player boundary, which removes network variability while keeping the important application seams real. The reset checks the exact test database before deleting fixtures, and the backend integration suite separately covers worker concurrency and atomicity.”

## Follow-up questions

**Does this verify YouTube playback?** No. The suite verifies our IFrame API integration contract and error fallback. A separate live smoke check is needed to establish real video availability.

**Why not start the worker and pause it?** Without a worker, each browser state is deterministic and the test does not race an external caption request. Worker behavior already has backend-level integration coverage.

**How should this run in CI?** Provision the same isolated PostgreSQL service, install the Playwright Chromium browser, then run `npm run test:e2e`; keep provider keys and real external API calls out of the pipeline.
