# Changelog

Notable project changes are recorded by build phase. Entries describe what was delivered and verified at the time, including limitations.

## Phase 1 — Accounts and isolation (in review)

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
