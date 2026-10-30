# VidScribe Web UI

React and TypeScript client for the source library and source workspace.

## Development

Run `npm install` and `npm run dev` from this directory. Vite reads the repository-root `.env` for `FRONTEND_PORT` and `BACKEND_PORT`, then proxies browser `/api` requests to the backend. The browser API client uses relative paths so it does not need a separate backend URL in local development.

## UI boundaries

- `App.tsx` owns lightweight path navigation and global library/dependency state.
- `components/` owns page-level library, source, and Q&A presentation.
- `services/api.ts` owns typed HTTP calls and error mapping.
- `types/types.ts` contains browser DTOs.
- `App.css` and `index.css` contain the current product styling.

The library, source lifecycle, and one conversation per ready source are restored from the API. Message statuses and citations persist across refreshes. The browser reuses a turn UUID when resuming a pending or retryable answer; it does not own conversation history as the source of truth.
