# Changelog

Notable project changes are recorded by build phase. Entries describe what was delivered and verified at the time, including limitations.

## Session security fixes (in review)

- Authentication responses now use `Cache-Control: no-store`. Session checks time out after ten seconds, and newer checks supersede stalled requests.
- Eight server tests and twelve browser tests passed; the browser run built the application. Docker and a real two-user account-switch test remain unverified.

## Fastify reference and backend review (in review)

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
