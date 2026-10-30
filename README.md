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

## Documentation

Start with the [project guide](docs/PROJECT.md) for architecture, data flow, reliability boundaries, and local setup. The [UX map](docs/product/library-and-source-workspace.md), [evolution log](docs/architecture/evolution.md), [service guides](docs/services/), [decision records](docs/decisions/), and [interview reference](docs/interview/engineering-concepts.md) explain how and why the current system is designed.

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
