# IdentityHub build plan

## Goal and approach

Build a small, understandable Jira integration for reporting non-human identity findings. Users can connect Jira, create tickets in the UI, view their recent tickets, and issue restricted API keys for external systems. A separate command adds an AI blog digest. Use the same finding-creation service for all three entry points.

Use TypeScript in strict mode, React and Vite for the web interface, Fastify for the API, and SQLite with SQL migrations for storage. Docker Compose runs one application container that serves the built interface and API. Keep dependencies and abstractions to the minimum needed, and record why each dependency exists. The architecture and flows are illustrated in [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md).

## Planned interfaces

The browser calls only our API. Session-authenticated writes require a CSRF token. Health, authentication, Jira OAuth, site and project discovery, and session-authenticated finding creation and history are implemented. The Jira UI and API key management are implemented; the scanner endpoint is implemented and the digest remains planned.

| Interface | Purpose |
| --- | --- |
| `GET /healthz` | Report application health. |
| `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session` | Manage accounts and sessions; the session response includes a CSRF token. |
| `POST /api/jira/connect` | Start a session-bound Jira OAuth connection and return the authorization URL. |
| `GET /api/jira/callback` | Validate OAuth state, exchange the code, and store the connection. |
| `GET /api/jira/sites`, `POST /api/jira/site` | List and select an accessible Jira site. |
| `GET /api/jira/projects` | List projects available to the connected user. |
| `POST /api/findings` | Validate and create a ticket for the signed-in user. |
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

**Current status:** Merged in PR #2. Tests cover cookie flags, session renewal and expiry, logout, CSRF rejection, generic login errors, rate limiting, user/session isolation, registration feedback, and the browser account flow. Add resource isolation tests as each later resource is implemented.

### 2. Framework alignment and foundation

Add the responsive workspace shell, local finding drafts, settings, and session resilience; review the existing backend using the Fastify reference and address identified security issues. These UI states do not provide Jira or API-key functionality.

**Current status:** UI and backend-review slices merged in PRs #3–#7. The current app image and container test profile passed in a disposable Compose project with the example environment and a separate volume. Mobile layouts were visually reviewed at 375 pixels. A browser test switches two local users across tabs with an open draft and verifies it is cleared. Provider integration and live-provider checks remain unverified.

### 3. Jira connection

Groundwork: the standalone local fake models authorization, code exchange, and accessible resources. The app starts OAuth, validates session-bound state, exchanges the code, and stores user-scoped encrypted tokens. Tests use fakes without provider calls. Refresh rotation, user coordination, site selection, and project discovery are implemented in the backend; the owner completed a live OAuth callback and saved a site, while live project discovery and ticket creation remain unverified; connection and selection UI are implemented in the current slice.

Recheck current Atlassian documentation; implement a fake service, OAuth connection, encrypted token storage, refresh rotation with a per-user lock, and project discovery.

**Done when:** fake-service tests cover the happy path, replay, mismatched and expired state, rotation, concurrent refresh, revoked access, and secrets absent from logs.

### 4A. Findings backend and recent tickets

The session-authenticated finding service, project authorization, Jira issue creation, and local recent-ticket API are implemented. Implement the form and recent-list UI later. Choose a supported non-subtask issue type using the configured default where available.

**Done when:** tests cover validation, project permissions, safe Jira errors, text-only document content, stored-site links, per-site serialization, and user/project-scoped recent results ordered newest first and limited to ten.

### 4B. Jira connection and findings UI

The current slice connects settings, site selection, and project selection to the authenticated APIs. It offers setup guidance and a retry after a project discovery failure. Browser scenarios cover missing or invalid configuration and confirm that a fake OAuth exchange was actually attempted and rejected. The current findings slice connects the form and recent-ticket view, binds browser requests to the selected site, validates safe links, and prevents silent retries after uncertain write outcomes. Browser tests use fake providers and isolated databases.

### 5. External API

API-key management and scanner authentication are implemented. The scanner verifies current Jira project IDs and key revocation, fails closed for legacy records without IDs, and uses the shared finding service with bounded input, rate limits, and idempotency. The contract is in [scanner-openapi.yaml](scanner-openapi.yaml). Owner-run live scanner and Docker checks remain outstanding.

**Done when:** tests cover all documented response codes, hashed-only key storage, revoked keys, cross-user access, concurrent requests, body conflicts, and unknown outcomes.

### 6. AI blog digest

Discover posts from the sitemap with a metadata cache, one request at a time, at least 500 ms between requests, bounded responses and timeouts, and an HTTPS host allowlist. Select the latest `datePublished` across the covered sitemap; explain the selection rule. Summarize untrusted article text with a configurable model adapter that has no tools, validate its output, and use the shared finding service. Do not store article text.

**Done when:** fake-only tests cover out-of-order listings, re-stamped dates, crawl and parse failures, model errors, output validation, injection attempts, and duplicate states. `--dry-run` creates no ticket; `--require-ai` fails if the model is unavailable. Without that flag, extractive fallback is explicitly marked degraded and exits with code 3. Choose a provider before implementing its adapter and check its current documentation.

### 7. Live verification

The owner configures a Jira test site and model provider and manually checks OAuth, form creation, description rendering, API creation, and the digest with real AI. Record actual results and failures; fake tests do not prove provider behavior.

**Done when:** live checks are recorded, with any outstanding checks clearly identified.

### 8. Review and submission

Review security and isolation, fix findings, write setup and architecture documentation, inspect the submission archive, and record a short demo.

**Done when:** tests and security review pass, the archive contains no secrets, databases or dependencies, and the owner can explain the design and limitations. Prepare a repository link and a clean compressed project.

## Working practices and scope

Work one phase at a time. After each phase run tests, review the security requirements touched, report passing and unverified checks, and have the owner review the diff before its commit. Automated tests use fakes; the owner controls credentials, account setup, and live service writes. Record design decisions and dependency purposes as the project evolves.

Scheduling, teams and roles, SSO, Jira webhooks, automatic reconciliation, a durable job queue, audit logs, and multi-region deployment are out of scope. The provider, model, and cost for the AI path remain to be chosen.

## UI foundation (merged, PR #3)

The UI foundation adds a responsive shell and Radix account menu around the existing authentication flow.

## Findings draft (merged, PR #4)

The reporting view holds an unsent draft in memory, warns before leaving, and does not call Jira. The ticket ledger remains unavailable rather than showing a fabricated empty result.

## Settings and session handling (merged, PR #5)

That phase introduced accessible tabs for the then-unavailable Jira and API-key features. Jira connection is now available in the current slice. Session checks use the existing endpoint on focus and visibility changes.

## Backend review and security fixes (merged, PRs #6 and #7)

The project-local Fastify reference and a review of existing authentication and session handling are available in `docs/BACKEND_REVIEW.md`. The identified cache policy and stalled session-check issues were fixed; the review predates provider integration.
