# IdentityHub build plan

## Goal and approach

Build a small, understandable Jira integration for reporting non-human identity findings. Users can connect Jira, create tickets in the UI, view their recent tickets, and issue restricted API keys for external systems. A separate command adds an AI blog digest. Use the same finding-creation service for all three entry points.

Use TypeScript in strict mode, React and Vite for the web interface, Fastify for the API, and SQLite with SQL migrations for storage. Docker Compose runs one application container that serves the built interface and API. Keep dependencies and abstractions to the minimum needed, and record why each dependency exists. The architecture and flows are illustrated in [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md).

## Planned interfaces

The browser calls only our API. Session-authenticated writes require a CSRF token. The health and authentication routes are implemented in the current phase 1 changes; Jira, findings, API keys, and digest interfaces remain planned.

| Interface | Purpose |
| --- | --- |
| `GET /healthz` | Report application health. |
| `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session` | Manage accounts and sessions; the session response includes a CSRF token. |
| `POST /api/jira/connect` | Start a session-bound Jira OAuth connection and return the authorization URL. |
| `GET /api/jira/callback` | Validate OAuth state, exchange the code, and store the connection. |
| `GET /api/jira/projects` | List projects available to the connected user. |
| Finding form route | Validate and create a ticket for the signed-in user. |
| `GET /api/findings?project=KEY` | Return this user's ten most recent app-created tickets for the selected project. |
| API key management routes | Create, list, and revoke the user's keys and restrict each key to allowed projects. |
| `POST /api/v1/findings` | Create a finding using `X-API-Key` and an optional `Idempotency-Key`. |
| `npm run digest -- [--dry-run] [--require-ai]` | Select the newest blog post, summarize it, and optionally create a ticket. |

The external API accepts `project`, `title` (1–255 characters), `description` (up to 20,000 characters), and optional `type`, `severity` and `resource`. Success returns `201`, `{ issueKey, url }`, and a `Location` header. Cover malformed JSON (400), invalid credentials (401), forbidden projects (403), missing Jira projects (404), conflicts (409), validation errors (422), rate limits (429), and safe upstream errors (502). Validation errors include field-level messages; rate limits include `Retry-After`.

## Data and security

Store users, hashed server-side session IDs and CSRF tokens, encrypted Jira credentials, short-lived OAuth states, hashed API keys and their allowed projects, and app-created issue records in SQLite. Store idempotency and digest states per user; the global blog cache contains only post metadata, never article text. Every user-data lookup uses the authenticated user identity, never a user ID supplied by the request.

Use HttpOnly, SameSite=Lax cookies, with Secure on HTTPS; rotate the session at login, enforce expiry, invalidate it at logout, and rate-limit login. Bind single-use OAuth state to both user and session, expire it after ten minutes, and serialize token refreshes per user. Encrypt Jira tokens at rest, show API keys only once, and keep credentials out of responses, logs, tests, and the repository.

Check project creation permissions through Jira and additionally enforce API-key project restrictions. Construct issue links from the stored site URL. Build descriptions as text nodes in Atlassian Document Format, render text safely, bound request sizes and outbound timeouts, and prevent cross-host redirects. Serialize Jira creates per site with a bounded queue.

For idempotent API calls and digest runs, reserve a unique `pending` record before creating a ticket, then mark it `done` on success. Clear it only on a definite failure. A timeout, lost connection, or stale digest reservation becomes `unknown` and requires human review; do not retry automatically. This reduces duplicates but cannot guarantee exactly-once creation. If Jira succeeds but local persistence fails, return the issue key, log it safely, and preserve the uncertain state for review rather than creating another ticket.

## Phases

### 0. Project foundation

Set up the workspaces, strict type checking, health endpoint, tests, environment examples, ignore rules, and Docker Compose. Serve the built web application from the API container.

**Done when:** clean installation, tests, build, Docker build and startup, placeholder page, health check, and Docker test profile pass, including native dependency installation.

### 1. Accounts and isolation

Implement SQLite migrations, registration, login, logout, sessions, CSRF, security headers, login and registration rate limits, and two-user isolation tests. Add a basic account interface with helpful submit-time validation and browser end-to-end tests using a temporary database.

**Current status:** Merged in PR #2. Host and browser tests passed; the final Docker rebuild remains unverified. Tests cover cookie flags, session renewal and expiry, logout, CSRF rejection, generic login errors, rate limiting, user/session isolation, registration feedback, and the browser account flow. Add resource isolation tests as each later resource is implemented.

### 2. Jira connection

Recheck current Atlassian documentation; implement a fake service, OAuth connection, encrypted token storage, refresh rotation with a per-user lock, and project discovery.

**Done when:** fake-service tests cover the happy path, replay, mismatched and expired state, rotation, concurrent refresh, revoked access, and secrets absent from logs.

### 3. Findings and recent tickets

Implement the shared finding service, project authorization, Jira issue creation, form, and recent list. Choose a supported non-subtask issue type using the configured default where available.

**Done when:** tests cover validation, project permissions, safe Jira errors, text-only document content, stored-site links, per-site serialization, and user/project-scoped recent results ordered newest first and limited to ten. Links open safely in a new tab.

### 4. External API

Add API-key creation, listing and revocation, project restrictions, the scanner endpoint, rate limits, idempotency, and a short OpenAPI document.

**Done when:** tests cover all documented response codes, hashed-only key storage, revoked keys, cross-user access, concurrent requests, body conflicts, and unknown outcomes.

### 5. AI blog digest

Discover posts from the sitemap with a metadata cache, one request at a time, at least 500 ms between requests, bounded responses and timeouts, and an HTTPS host allowlist. Select the latest `datePublished` across the covered sitemap; explain the selection rule. Summarize untrusted article text with a configurable model adapter that has no tools, validate its output, and use the shared finding service. Do not store article text.

**Done when:** fake-only tests cover out-of-order listings, re-stamped dates, crawl and parse failures, model errors, output validation, injection attempts, and duplicate states. `--dry-run` creates no ticket; `--require-ai` fails if the model is unavailable. Without that flag, extractive fallback is explicitly marked degraded and exits with code 3. Choose a provider before implementing its adapter and check its current documentation.

### 6. Live verification

The owner configures a Jira test site and model provider and manually checks OAuth, form creation, description rendering, API creation, and the digest with real AI. Record actual results and failures; fake tests do not prove provider behavior.

**Done when:** live checks are recorded, with any outstanding checks clearly identified.

### 7. Review and submission

Review security and isolation, fix findings, write setup and architecture documentation, inspect the submission archive, and record a short demo.

**Done when:** tests and security review pass, the archive contains no secrets, databases or dependencies, and the owner can explain the design and limitations. Prepare a repository link and a clean compressed project.

## Working practices and scope

Work one phase at a time. After each phase run tests, review the security requirements touched, report passing and unverified checks, and have the owner review the diff before its commit. Automated tests use fakes; the owner controls credentials, account setup, and live service writes. Record design decisions and dependency purposes as the project evolves.

Scheduling, teams and roles, SSO, Jira webhooks, automatic reconciliation, a durable job queue, audit logs, and multi-region deployment are out of scope. The provider, model, and cost for the AI path remain to be chosen.

## UI foundation in review

The current UI slice adds a responsive shell and Radix account menu around the existing authentication flow. Findings, reporting, and settings functionality remain future slices. Verify the latest Docker image and browser screenshots before recording them as passed.

## Findings draft slice in review

The reporting view holds an unsent draft in memory, warns before leaving, and does not call Jira. The ticket ledger remains unavailable rather than showing a fabricated empty result. Full session refresh and identity-change handling remains a later slice.
