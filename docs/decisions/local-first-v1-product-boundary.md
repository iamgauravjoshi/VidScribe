# Decision: Local-First, Single-User V1

**Status:** Working decision for the first useful release  
**Date:** 2026-10-29

## Problem

VidScribe needs a concrete product boundary before expanding its data model, UI, or infrastructure. The current repository uses a local PostgreSQL database and Ollama, but it does not define whether the target is a personal local tool or a hosted multi-user service. Those choices materially change identity, privacy, deployment, inference, and operational requirements.

## Options considered

### Local-first personal workspace

The user runs VidScribe locally, stores sources and conversations in a local database, and uses a local model provider. This matches the current stack and limits account and hosting work. It also requires a clear local setup and depends on the user's machine having enough resources.

### Hosted single-user service

VidScribe runs in the cloud for one user. It reduces local installation work but still requires remote data storage, hosted inference or remote model operation, secrets management, backups, and a privacy policy.

### Hosted multi-user SaaS

VidScribe supports accounts, workspaces, sharing, and multiple users. This can serve a broader product but requires authentication, authorization, tenant isolation, hosted operations, abuse controls, and a substantially larger security and support surface.

## Chosen boundary

Build V1 as a local-first, single-user web application for a personal library of educational YouTube videos. Use local PostgreSQL/pgvector and Ollama by default. Keep YouTube as the sole input source for V1, with source evidence and persistent conversations as product goals. Conversation persistence is not implemented in the current source-lifecycle slice.

The data model now uses a source-neutral identity `(source_type, external_id)` and a durable job record, while YouTube remains the only implemented source adapter. Do not add more adapters until a second input type has concrete requirements.

## Why this fits now

- It gives the current local stack a coherent product purpose.
- It avoids building login, tenant isolation, and cloud operations before multi-user use is in scope.
- It provides a concrete privacy and deployment model while retaining a narrow adapter boundary for future sources and inference providers.
- It lets the first release focus on the complete user journey: add, process, ask, inspect citations, return, and remove.

## Trade-offs and failure scenarios

- The user must install or start the local dependencies; onboarding and health diagnostics are product requirements, not optional polish.
- Local hardware varies, so inference latency and model availability will vary. The app must show actionable dependency and processing states.
- YouTube transcript retrieval still requires a network call to YouTube or the transcript provider. “Local-first” must not be marketed as “no data ever leaves the device.”
- Users cannot sync or share work across machines in V1. A later hosted mode will require an explicit migration and ownership model.
- Local database files and backups become the user's data-resilience boundary; backup/export behavior should be addressed before calling the application production-ready.

## Deferred work

Do not add multi-user authentication, cloud sync, hosted model providers, collaborative workspaces, RabbitMQ, or broad source-plugin infrastructure as part of this decision. Revisit each only when user needs or measured operational limits justify it.

## Interview explanation

“I bounded the first release as a local-first personal research workspace because the initial user value is understanding and revisiting video content, while the current stack already supports local persistence and inference. That keeps the first release focused and avoids prematurely adding identity and tenant-isolation complexity. I’m explicit that transcript retrieval contacts YouTube and that local-first sacrifices sync and collaboration. If hosted multi-user use becomes a requirement, I would revisit data ownership, auth, inference, and operations together rather than treating deployment as a simple switch.”
