# Changelog

Notable project changes are recorded by build phase. Entries describe what was delivered and verified at the time, including limitations.

## Phase 3 — Token exchange and encrypted storage (in review)

- Exchange single-use OAuth codes using `jira.js`, request offline access, and store per-user access and refresh tokens encrypted with AES-256-GCM. Exchange errors are sanitized; no real provider checks have been performed. Refresh and project discovery remain unimplemented.
- All 24 host and Docker tests passed; host lint and build, dependency audit, Docker runtime build, and fresh-database migration and health checks passed. Tests cover invalid configuration, user isolation, authenticated encryption, replay, logout during exchange, upstream errors, redirects, oversized responses, and a stalled exchange. Browser and real-provider checks remain unverified.

## Phase 3 — OAuth state handling (merged in PR #10)

- Added an authenticated, CSRF-protected OAuth start and callback with user- and session-bound, expiring, single-use state. Request logs omit query strings. Callback validation does not exchange codes or connect Jira; token storage and exchange remain future work.
- Limited server test files to one worker and raised the default test timeout to 15 seconds to reduce resource-related authentication test failures without changing password hashing.
- The normal host and rebuilt Docker test commands each passed all 17 tests with the new defaults. The Docker image build also passed; the serial suite takes longer and unusually slow machines may still exceed the timeout.
- Host suite passed 16 tests before the final user-scoped cleanup change; the final focused OAuth suite passed three tests. Lint and host build passed. The final Docker suite passed all 17 tests with one worker, and the runtime image passed a fresh-database migration and health check. Default concurrent Docker runs timed out in three existing authentication tests; live provider behavior and browser UI remain unverified.

## Phase 3 — Fake Atlassian groundwork (merged in PR #9)

- Added a standalone loopback-only fake for authorization, code exchange, and accessible resources, with fixed public test values. Real OAuth, refresh, token storage, projects, and UI integration remain unimplemented.
- Twelve server tests passed, including four focused fake-service tests; lint, build, audit, and a local listener smoke test passed. An earlier concurrent test run timed out twice; the subsequent standalone run passed. Docker was initially missing from the shell PATH; the installed engine was subsequently found. Live provider behavior remains unverified.
- Selected `jira.js` 6.3.0 for the future Jira client; test-only routing exercises its OAuth helpers against the fake without provider calls.
- Evaluated temporary `jira.js` 6.3.0 installation and its OAuth helpers with intercepted fake responses; documented its URL, refresh, retry, timeout, redirect, and error-handling trade-offs.
- Rebuilt the Docker test image and passed all 12 container tests using the installed Docker executable. The standalone fake is not verified as a container service.
- After adding the SDK, all 14 host and container tests passed, as did lint, build, dependency audit, runtime image build, and an isolated runtime health check. An initial container test run had two timeouts while the runtime check ran concurrently; a subsequent standalone run passed. Real provider behavior remains unverified.
- Review rerun: lint and audit passed; three host tests timed out with checks running concurrently, then all 14 passed when rerun separately. The Compose mock profile remains unsupported because its listener is bound to container loopback.

## Phase 2 — Framework alignment and foundation verification (merged in PR #8)

- Built and ran the app with an isolated Docker Compose project using the example environment and a temporary volume. The app and health endpoint returned 200, Compose reported healthy, and the container test profile passed eight server tests.
- Reviewed the authentication, findings, report, draft confirmation, and settings screens at a 375-pixel mobile viewport; no horizontal overflow was detected.
- All 14 browser tests passed, including two local users switching accounts across tabs while an unsent draft was open; the first user's draft and project key were cleared when the session refreshed.
- Browser tests run in two independently isolated server/database groups to avoid exhausting the shared registration rate limit. No real provider services or credentials are used.
- Grouped the merged UI and backend-review work as phase 2 and moved subsequent planned phases forward by one; Jira connection is now phase 3.

## Session security fixes

Merged in [PR #7](https://github.com/nim901/IdentityHub/pull/7).

- Authentication responses now use `Cache-Control: no-store`. Session checks time out after ten seconds, and newer checks supersede stalled requests.
- Eight server tests and twelve browser tests passed; the browser run built the application. Docker and a real two-user account-switch test remain unverified.

## Fastify reference and backend review

Merged in [PR #6](https://github.com/nim901/IdentityHub/pull/6).

- Added a project-local third-party Fastify reference and reviewed the current authentication and session implementation. No backend features or contracts were changed.
- The Fastify-assisted security review found that session responses containing account information and the CSRF token lack an explicit `Cache-Control: no-store` header, allowing clients or intermediaries to retain them depending on their caching behavior. The issue is documented for a separate fix; it has not been fixed in this phase.
- Seven server tests and ten browser tests passed, and the browser run built the application. Docker and live-provider checks remain unverified.
- Review findings and suggested follow-up tests are in `docs/BACKEND_REVIEW.md`.

## Settings and session handling

Merged in [PR #5](https://github.com/nim901/IdentityHub/pull/5).

- Added keyboard-accessible Settings tabs with clear unavailable states for Jira connection and API keys.
- Recheck sessions on focus or visibility changes. Confirmed expiry and account changes clear unsent drafts; a transient check failure keeps the draft. Failed sign-out reports that the session may still be active and offers retry.
- Seven server tests and ten browser tests passed, and the browser run built the application. Docker and visual/mobile checks remain unverified.

## Local finding draft

Merged in [PR #4](https://github.com/nim901/IdentityHub/pull/4).

- Added an unavailable recent-ticket ledger and a reporting view with a temporary in-memory draft. No Jira requests are made.
- Added a Radix confirmation before discarding a draft and a browser-controlled warning on document unload.
- Seven server tests, six browser tests, type checks, and the build passed. Session refresh and cross-tab identity-change handling remain future work; Docker and visual checks remain unverified.

## UI foundation

Merged in [PR #3](https://github.com/nim901/IdentityHub/pull/3).

- Added a responsive account shell and accessible Radix account menu while retaining the existing authentication API. Jira connection remains unavailable.
- Radix Dropdown Menu provides keyboard and focus behavior; custom CSS implements the workspace appearance.
- Added field-level validation, accessible error associations, and a session-check retry screen.
- The latest Docker rebuild and browser visual checks must be verified on the current machine before claiming they pass.

## Phase 1 — Accounts and isolation

### Added

- Account registration, sign-in and sign-out, server-side sessions, Argon2id password hashing, CSRF protection, security headers, and rate limits.
- SQLite migrations, a user-scoped authentication repository, and a reusable two-user isolation test helper.
- Submit-time form validation and clearer registration feedback, including duplicate-email handling.
- Browser end-to-end tests using an isolated temporary database, plus setup and security guidance in the README.

### Verification and limits

- Server tests, type checks, build, and browser end-to-end tests passed locally. The latest container rebuild remains unverified because Docker was unavailable during the final check.
- The in-memory rate limiter resets on restart and is not shared between instances. Duplicate-registration feedback reveals whether an email is registered.
- Jira, ticket creation, API keys, and the AI digest remain planned.

## Phase 0 — Project foundation (2026-10-30)

Merged in [PR #1](https://github.com/nim901/IdentityHub/pull/1).

### Added

- TypeScript npm workspaces for a Fastify API and React/Vite web interface, with strict type checking.
- A placeholder page, static-file serving, `GET /healthz`, and an automated health test.
- Docker and Compose configuration for the application and test profile, with a persistent data volume and health check.
- Environment templates and ignore rules to keep local credentials, databases, dependencies, and build artifacts out of commits and Docker build context.
- Build plan, planned system design and database schema, and architecture trade-offs.

### Verification

- Host installation, tests, build, type checks, and dependency audit passed.
- Docker image build, placeholder page, health endpoint, Compose health check, and Docker test profile passed.
- Authentication, Jira, API keys, findings, and the AI digest were not implemented or live-tested in this phase.
