# Pull request validation with GitHub Actions

**Status:** Accepted — hosted baseline passed; timestamp-correction changes pending a fresh run
**Date:** 2026-11-03

## Problem

The source evidence workspace has a repeatable Playwright suite and PostgreSQL lifecycle integration scenarios, but they only ran when a developer remembered to start them locally. The repository had no check on pull requests, so a change could merge after a build while breaking a migration, database lifecycle, or browser interaction.

The first hosted run also exposed a platform-specific dependency lock issue before reaching the database or browser steps: backend TypeScript 7 depended on a native compiler package, while the Windows-generated lockfile contained only the Windows binary. The Ubuntu runner could not resolve its Linux compiler.

## Naive approach

Run only TypeScript builds and lint in GitHub Actions, mock the API in browser tests, or call the configured AI provider during each workflow run.

## Why that is problematic

- A build does not verify transaction semantics, migrations, PostgreSQL full-text behavior, or the browser's interaction with real API responses.
- Fully mocked browser tests skip the persistence and search contracts this workspace depends on.
- Live AI or YouTube requests require secrets, can incur charges, depend on external availability, and make pull request results nondeterministic.
- Running against a developer database would risk user data and make the check environment-dependent.

## Chosen approach

The `CI` workflow runs on every `pull_request`, on pushes to `main`, and by manual dispatch. One Ubuntu job installs the locked npm workspaces, builds backend and frontend, runs frontend lint, starts the dedicated `docker-compose.test.yml` PostgreSQL database, runs the backend suite including its opt-in PostgreSQL integration case, installs Chromium, and runs `npm run test:e2e`.

Both workspaces use TypeScript `~6.0.2` (6.0.3 in the lockfile). The backend has no TypeScript 7-only language dependency, and TypeScript 6 successfully builds it. Sharing the frontend's compiler removes the OS-specific native package that failed on the hosted Linux runner and keeps the two workspaces on one compiler toolchain.

The workflow supplies only test-database environment variables. It does not define provider keys or call the AI provider. The browser suite uses the real local API and PostgreSQL, while its YouTube player boundary is stubbed and the ingestion worker is excluded. If the job fails, GitHub uploads Playwright's `test-results/` and HTML report for 14 days. A final `always()` step stops the Compose service and leaves its named test volume intact.

Third-party actions are pinned to full commit SHAs. The job has read-only repository permissions, a 30-minute limit, and cancels obsolete runs for the same pull request/ref.

## Why we chose it

This workflow reuses the exact isolated test database and browser runner already used locally. It validates the correlated build, database, and UI contracts without a second test harness or provider-specific configuration. A single job shares one disposable PostgreSQL instance between lifecycle integration tests and Playwright, avoids duplicate dependency installs, and is easy to inspect when a failure occurs.

The workflow publishes a named check (`Build, PostgreSQL, and Playwright`). It does not itself change repository branch-protection settings; requiring the check before merge is a GitHub repository policy decision.

Real-source retrieval measurement is intentionally separate from the required gate. The opt-in `real-source-evaluation.yml` workflow runs only when the `evaluate-real-source-search` label is applied to a pull request or it is manually dispatched. It uses a fresh isolated PostgreSQL database, fetches captions from three public YouTube sources, and measures local search/citation behavior without an answer-provider call or key. This sample can be affected by caption availability and is diagnostic rather than a merge gate.

## Example

For a pull request that changes transcript publication, the build and lint run first. The integration test then migrates a fresh test database and checks rollback/retry/concurrency behavior. Playwright reuses that database, seeds its own source fixtures, and checks transcript search, citations, exports, refresh states, and responsive layout through the real API and UI. A failing browser assertion produces trace/screenshot files that are downloadable from the Actions run.

## Failure scenarios

- A failed install, build, lint, database health check, migration, backend test, or browser assertion marks the pull request check failed.
- When Playwright produced output, failure artifacts include trace/screenshot files under `test-results/` and the HTML report. If an earlier step fails before Playwright runs, the upload step safely ignores missing artifacts.
- PostgreSQL startup or test failures still execute the database cleanup step. The `down` command stops containers but preserves the named test volume.
- The integration test requires `VIDSCRIBE_TEST_DATABASE_URL` and a database name containing `test`; the test Compose target uses the dedicated `vidscribe_test` database. No production or development database credentials are provided.
- A cancelled or timed-out workflow may not complete every cleanup operation; the GitHub-hosted runner is ephemeral and is discarded after the job.
- The first attempt failed in the backend build because the TypeScript 7 Linux compiler package was absent from the Windows-generated lockfile. Aligning the backend with the existing TypeScript 6 compiler fixed the problem; hosted run 41594485760 passed build, lint, 14/14 backend/PostgreSQL tests, and 5/5 Chromium tests. The timestamp-unit correction adds another migration test and must pass a fresh hosted run before this PR is complete.

## Concurrency scenario

Runs for the same pull request/ref share a concurrency group. A newer commit cancels the older run so stale results do not consume runner capacity. Separate pull requests use separate GitHub-hosted runners and therefore separate Docker containers/volumes. Inside one run, the backend database suite completes before Playwright reuses the same database; the Playwright configuration uses one worker so shared fixtures remain deterministic.

## Trade-offs

- **Gain:** every pull request receives the same build, lint, PostgreSQL, and browser validation; failures have downloadable browser diagnostics; tests make no provider calls.
- **Cost:** the real browser and PostgreSQL make the workflow slower than unit-only CI. Chromium installation and database startup consume hosted runner minutes.
- **Scope:** this gate validates current local application behavior. It does not validate live caption availability, real YouTube playback, provider credentials/model access, deployment, or semantic answer truthfulness.
- **Enforcement:** the workflow creates a check, but administrators must configure GitHub branch protection if merges should be blocked until it passes.
- **Reliability evidence:** the hosted PR run 41594485760 passed the complete baseline gate in about 65 seconds. The follow-up run validates the new timestamp-unit migration and adapter tests as part of this PR. Repeated failures should be classified as code defects, environment assumptions, or flaky checks before adding retries.

## Alternatives

- **Build/lint only:** faster, but leaves the database lifecycle and user-facing transcript/citation flows unchecked.
- **Separate build, integration, and browser jobs:** can reduce wall time, but duplicates checkout/install and requires separate database provisioning. Revisit if measured job duration becomes a problem.
- **GitHub PostgreSQL service container:** simpler for a single integration job, but the existing E2E runner expects Docker Compose and discovers its published port; keeping the repository's Compose target avoids divergent local and hosted test environments.
- **Keep TypeScript 7 and add its Linux binary to the lockfile:** preserves the distinct compiler, but VidScribe has no feature requiring that compiler and would retain a platform-specific optional native dependency. Sharing the compiler used by the frontend is simpler and was verified against the backend source.
- **Provider smoke tests in pull requests:** rejected because credentials, billing, and external outages should not determine the merge check. Provider connectivity remains an explicit manual/environment-level check.

## Interview explanation

“I made CI reuse the same isolated PostgreSQL and Playwright harness developers use locally. Every pull request builds both workspaces, lints the frontend, exercises database transaction and lifecycle behavior, then checks the real API/UI flow in Chromium. The AI and caption provider boundaries stay stubbed, so the gate is deterministic and secret-free; failed browser runs retain traces and screenshots for debugging.”

## Follow-up questions

**Does this guarantee the check is required before merge?** No. GitHub branch protection or a repository ruleset must require the named check; the workflow only runs and reports it.

**Why is real-source retrieval evaluation opt-in?** Caption fetching depends on an external provider and can fail independently of VidScribe changes. The required gate therefore remains deterministic and secret-free. A labeled/manual workflow still allows a real-caption sample when product decisions need evidence, without making every pull request wait on YouTube.

**When should jobs be split or cached more aggressively?** After hosted run duration shows a real bottleneck. Today one job avoids duplicate installs and shares one test database across the two database-backed suites.
