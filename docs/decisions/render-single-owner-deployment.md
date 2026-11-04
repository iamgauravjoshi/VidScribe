# Render single-owner deployment

## Status

Accepted for private preview deployments. Revisit before opening the application to multiple users.

## Problem

The Render build completed, but Render then ran `yarn start` at the repository root, where no root start script existed. Even with a valid start command, the backend bound only to loopback, the frontend build was not served by Express, the database configuration expected local `POSTGRES_*` values, and provider-key encryption depended on a local key file that is not a stable deployment secret.

## Naive approach

Point Render directly at the backend start script, or add a root script that only starts the backend.

## Why that is incomplete

The browser would still have no production UI server, Render would not be able to reach a loopback-only listener, the service would not receive its expected database URL, and provider credentials could become undecryptable after an instance restart.

## Chosen approach

Use one Render Node web service for the React static build and Express API, with one managed PostgreSQL database. The build explicitly installs dev dependencies for TypeScript/Vite, runs the build, then prunes dev dependencies from the runtime image. The marketing page remains public at `/`; `/library`, source/settings pages, and API routes use HTTP Basic Authentication with a password provided through Render's dashboard. `npm start` runs the production migration command before the API server. The server binds to Render's `PORT` on `0.0.0.0`. Render injects `DATABASE_URL` and a generated base64 256-bit encryption key.

## Why this fits now

The frontend already uses relative `/api` URLs and React pathname routing, so same-origin serving avoids separate hostnames, CORS configuration, and a browser API URL. A shared password gate makes the current single-owner boundary explicit while leaving the marketing homepage crawlable. Database migrations are serialized by a PostgreSQL advisory lock and can run safely before each process starts.

## Example and failure behavior

On deploy, Render builds both npm workspaces, runs `npm start`, applies pending migrations, and starts the server. If the database URL, access password, or encryption key is missing or invalid, the service fails at startup instead of silently running without its persistence or credential guarantees. Render checks `/api/health/live`, which verifies process responsiveness without requiring a user to configure an AI provider first.

## Concurrency and limitations

The app remains one shared VidScribe workspace protected by one password. It does not have user identities, per-user source ownership, or workspace-level authorization. This is suitable only for a private personal deployment or trusted preview. Giving multiple people the password gives them access to the same sources, conversations, and provider configuration. Basic Authentication is not a substitute for a future account system.

The generated encryption key must remain unchanged across restarts and deploys. A new Render database starts empty; local PostgreSQL contents and locally encrypted provider keys are not migrated automatically. Existing provider keys should be re-entered after deployment unless a deliberate database and encryption-key migration is planned.

## Trade-offs and alternatives

- **Chosen:** one service and same-origin API/UI. Fewer deployment components and no CORS; the Node process serves static files.
- **Separate static site and API:** scales frontend hosting independently, but requires explicit production API URL, CORS, and coordinated environments. Not needed for the current single-owner use.
- **Public app without a gate:** less friction, but would expose the shared database and saved provider settings to every visitor; rejected.
- **Full authentication and multi-tenancy:** correct before serving independent users, but requires user/workspace schema, session management, authorization checks in every data access path, and migration work beyond fixing the Render startup error.

## Interview explanation

“I deployed the current single-user app as one same-origin service so the marketing routes, React app, and API share a host and avoid CORS. The server honors Render's port, serves the production bundle, migrates PostgreSQL before startup, and uses a stable platform secret to encrypt provider keys. Since VidScribe does not yet isolate data by user, the app routes and API require a strong shared password; I would build account-level authorization before opening it as a multi-user product.”
