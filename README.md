# VidScribe

VidScribe is a local-first workspace for asking questions about long-form learning content. The current release accepts public YouTube videos with English captions and returns answers grounded in timestamped transcript citations. Sources and their conversations are persisted in PostgreSQL, including pending and retryable answer states.

## Local development

1. Copy `.env.example` to `.env` and set the PostgreSQL password.
2. Install all workspace dependencies from the repository root: `npm install`.
3. Start PostgreSQL: `docker compose up -d postgres`.
4. Run migrations from the root: `npm run db:migrate`.
5. Start the API and UI together: `npm run dev`.
6. Ollama is not required. Transcript indexing and retrieval use PostgreSQL full-text search. Ollama remains an optional local answer provider; Gemini, OpenAI, and Claude are available under **Settings → AI model** after adding a key and passing the connection test.

The backend binds to `127.0.0.1`. Vite serves the local UI and proxies `/api` to it during development. In the app, open **Settings → AI model** to choose a provider, enter a key, and test/save the connection before new answers use it. The explicit test sends a short generation request and may incur provider usage. Gemini is selected by default; until you add its key or test/save another configured provider, question generation is disabled. Keys are encrypted by the backend and are never returned to the browser. PostgreSQL full-text search indexes transcript text locally; only the question and matched excerpts are sent to a selected cloud answer provider. The migrations rename the old video tables in place to preserve source and chunk rows, then add persisted conversations, provider settings, and the local search index; review them and back up an existing database before applying them.

## Render deployment

The root [`render.yaml`](render.yaml) defines one Render web service and a PostgreSQL database. The Node service serves the marketing page at `/`, serves the application UI at `/library` and its other app routes, and handles `/api` requests on the same origin. Render supplies `PORT` and `DATABASE_URL`; production migrations run before the server starts. The server binds to `0.0.0.0` in production and keeps loopback binding for local development.

To deploy, push this file to GitHub, then in Render choose **New → Blueprint**, connect the repository, and review the resources before applying. Render will ask you to set `VIDSCRIBE_ACCESS_PASSWORD`; use a long unique password and keep it private. The marketing homepage is public; app pages and API routes require HTTP Basic Authentication using username `vidscribe` and that password. This is a single-owner deployment with one shared workspace, not multi-user accounts. Do not give the password to untrusted visitors.

The Blueprint uses Render's free web and PostgreSQL plans to avoid creating paid resources without your approval. They are for previewing only: free web services can sleep, and free PostgreSQL expires after 30 days. Upgrade the database to a paid plan before storing anything you need to keep. Keep `VIDSCRIBE_SECRET_ENCRYPTION_KEY` unchanged and back it up securely; changing or losing it makes saved provider keys unreadable. Configure a Gemini or other provider key after opening **Settings → AI model** in the app.

## Documentation

Start with the [project guide](docs/PROJECT.md) for architecture, data flow, reliability boundaries, and local setup. The [UX map](docs/product/library-and-source-workspace.md), [evolution log](docs/architecture/evolution.md), [service guides](docs/services/), [decision records](docs/decisions/), and [interview reference](docs/interview/engineering-concepts.md) explain how and why the current system is designed.

## Automated browser suite

Install the browser once, then run the end-to-end suite from the repository root:

```powershell
npx playwright install chromium
npm run test:e2e
```

Docker Desktop must be running. The runner starts the isolated `vidscribe_test` database when needed, applies migrations, resets source fixtures in that test database, and starts the API and Vite on ports `8218` and `4178`. It never uses port `3000` or the development database. Playwright closes its API/UI processes at the end; the runner stops only the test database container it started and preserves its named volume.

The browser tests use the real API and PostgreSQL transcript search/export endpoints, but skip the ingestion worker and replace the YouTube IFrame API with a deterministic browser stub. They cover citation seeking and player fallback, TXT/SRT/VTT downloads, transcript search and pagination, mobile-width overflow, and legacy refresh states including retryable and non-retryable failures. They do not call YouTube or an AI provider.

## GitHub Actions validation

Every pull request runs the **Build, PostgreSQL, and Playwright** check. It installs the locked npm workspaces, builds backend and frontend, runs frontend lint, starts the isolated `vidscribe_test` PostgreSQL service, runs backend unit/integration tests, and executes the Chromium suite. No AI provider keys or live provider requests are configured. If the job fails, GitHub retains Playwright screenshots, traces, and the HTML report for 14 days. The workflow also runs on pushes to `main`; it does not use the development database or port `3000`.

Real-source evaluation is separate and opt-in because caption availability is external. Dataset v2 covers six public English-captioned sources through the normal ingestion and PostgreSQL full-text search path, with no AI provider credentials or generation calls. Caption-unavailable sources are reported and skipped; the run requires four usable sources and twelve labeled queries. Locally, `npm run eval:real-sources` requires a fresh isolated `vidscribe_test` database and writes `real-source-evaluation.json`; it removes only the source rows it creates. Review the [results and methodology](docs/evaluations/real-source-search-2026-11-03.md) before using this diagnostic sample to prioritize a product capability.

## PostgreSQL integration tests

After creating the repository-root `.env`, start the isolated test database from the repository root:

```powershell
docker compose -f docker-compose.test.yml up -d --wait
```

Then run the integration suite from the repository root against that database:

```powershell
$postgresPort = (docker compose -f docker-compose.test.yml port postgres-test 5432).Split(':')[-1]
$env:VIDSCRIBE_TEST_DATABASE_URL = "postgresql://vidscribe_test:vidscribe_test@127.0.0.1:$postgresPort/vidscribe_test"
npm test
Remove-Item Env:VIDSCRIBE_TEST_DATABASE_URL
```

The test container publishes PostgreSQL on an automatically assigned localhost port and uses its own named volume and database whose name includes `test`. To reset only this test database, run `docker compose -f docker-compose.test.yml down -v` from the repository root. The normal development database is configured separately by `docker-compose.yml`.
