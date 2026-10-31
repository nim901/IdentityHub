# Changelog

Notable project changes are recorded by build phase. Entries describe what was delivered and verified at the time, including limitations.

## Phase 6B - Article summary preview (in review)

- Add a read-only summary preview with bounded article extraction and a tool-free OpenAI Responses adapter. The selected article is untrusted, its text stays in memory, and the provider response is validated.
- Tests use fake transports only. An authorized read-only check of one Oasis article confirmed the body selector; OpenAI compatibility remains unverified. Direct ChatGPT plan OAuth and the Jira-writing digest command are not implemented.
- Review fixes reject changed article metadata before model use, validate configuration before discovery, and isolate the fake CLI child environment. Fake tests cover those cases and a stalled model request.
- Review verification: 76 server tests, lint, and build passed after the fixes. Browser tests were not rerun because this slice changes no browser flow. Docker was unavailable, so container behavior remains unverified.

## Phase 6A - Read-only blog discovery (merged, PR #19)

- Add a bounded discovery library and read-only command using the Oasis sitemap. Select by the visible publication date and heading, and report same-day ties; observed JSON-LD publication timestamps can be re-stamped.
- Review fixed acceptance of cached metadata with mismatched URLs, invalid dates, or unsafe titles; invalid entries are ignored and refetched.
- Automated tests use fake transports. An authorized read-only inspection confirmed robots.txt, sitemap structure, and article markup; a crawl of 110 posts passed before the conservative robots check was added. AI summarization and ticket creation remain future work.
- Review verification: 60 server tests, 28 browser tests, lint, and build passed. A regression first reproduced an unsafe cached URL; new tests also cover invalid cache records and overlapping streaming bodies. Earlier tests exposed the sitemap-entry limit, extra headings, and a Windows loader-path issue. The final robots check was verified with fakes, not another live crawl. Production audit reports the existing three moderate `@fastify/static`, `glob`, and `minimatch` findings. Docker was unavailable.

## Phase 5B - Scanner API (merged, PR #18)

- Add API-key-authenticated finding creation, project-ID and site checks, revocation rechecks, bounded input, rate limiting, and optional idempotency via the shared Jira finding service.
- Review fixed conflicting scanner requests being treated as replays when their fields formatted to the same Jira description, and corrected stale endpoint availability text. Previous uncommitted scanner fingerprints fail closed on replay.
- Add fake-provider security and end-to-end scenarios and an OpenAPI contract. Docker and owner-run live scanner verification remain outstanding.
- Review verification: 38 server tests, lint, build, and 28 browser tests passed using fake providers and isolated data. The fingerprint regression first reproduced a 200 instead of 409; an initial browser run found an outdated Settings assertion. Both pass after fixes. Earlier implementation runs also included a test-server startup timeout. Docker was unavailable.

## Phase 5A - API key management (merged, PR #17)

- Add user-scoped key creation, listing, and revocation with SHA-256 hashes, one-time display, and selected-site and project restrictions. Scanner authentication and the scanner endpoint remain for the next slice.
- Review fixed loss of the one-time secret when leaving during creation. New keys record discovered project IDs alongside keys; an additive migration preserves legacy records with missing IDs for future scanner authentication to reject until replaced.
- Use isolated browser and server tests; the key browser scenarios run in a separate test group to avoid sharing authentication rate limits. No real provider requests are made by tests.
- Review verification: 34 server tests, lint, build, and 27 browser tests passed with fake providers and isolated data. Regression tests first exposed the pending-navigation issue and legacy-key handling; an intermediate full run used a stale build and failed before the final passing run. An earlier browser run hit shared registration rate limits; isolating the key group fixed that test-harness failure. A failed regression test left a synthetic temporary database folder because automatic policy blocked its removal. Docker is unavailable, and the scanner endpoint and owner-run live verification remain outstanding.

## Phase 4B.2 - Finding creation and recent tickets (merged, PR #16)

- Connect the form and project-scoped recent-ticket view to the session-authenticated finding API; validate Jira links before opening them in a new tab.
- Prevent concurrent submissions, use one idempotency key per attempt, and require checking Jira before another attempt after an uncertain outcome. Drafts and uncertainty acknowledgment are in memory only.
- Bind session-token-bearing recent-ticket reads to the active session. Refresh history on focus only after the selected-site status is confirmed, preventing another site's tickets from appearing under an outdated site label.
- Bind browser finding writes and history reads to their expected site, and reject mismatches before returning tickets or issuing a Jira write. Existing API callers may omit the new optional field.
- Treat unrecognized 401, 403, 422, and 429 write responses as uncertain instead of assuming no ticket was created; preserve the draft when the session check still succeeds. Browser tests also cover a lost response after a fake Jira write.
- Review verification: 31 server tests, lint, the build, and 23 browser tests passed with fake providers and isolated data. Regression tests reproduced stale history, a site-refresh race, and unsafe classification of unrecognized responses before fixes; a lost-response test confirms one fake Jira write and no silent retry. Docker was unavailable. Live project discovery and live ticket creation remain unverified.

## Phase 4B.1 - Jira connection and project selection (merged, PR #15)

- Corrected the unconfigured Jira message so it does not imply an administrator role.
- Added a visible disabled Jira connection button and setup guidance, and made failed project discovery explicitly retryable without silently clearing its error.
- Strengthened the failed OAuth browser test to verify the fake token endpoint was actually called, using a marker in its isolated temporary test directory.
- Enabled configured live OAuth outside automated tests; the local preview now reads the existing `.env` without altering it. The owner completed a live OAuth callback and saved a Jira site; live project discovery and ticket creation remain unverified.
- Added browser-to-API coverage for missing Jira configuration, an invalid encryption key, and a rejected fake OAuth token exchange. Test servers clear inherited Jira settings and use isolated temporary databases.
- Connected Jira settings, OAuth return, site selection, and project discovery to the session-authenticated API. The finding form and ticket history remain unavailable in the UI.
- Review fixes bind browser Jira reads to the expected session, ignore late failures from an older session, and refresh connection state when a tab regains focus.
- Added user-scoped connection status and fake-provider browser coverage for connection, selection, access errors, empty projects, account switching, and mobile layout. Provider credentials stay server-side.
- Host checks: 31 server tests, lint, the build, and all 19 browser tests passed in the latest review. An earlier browser run timed out starting its test server while multiple commands ran concurrently; a subsequent run passed. Browser tests used temporary databases and fakes. Docker configuration was inspected; container checks could not run because Docker is unavailable. Live project discovery and ticket creation remain unverified.
- The production dependency audit reported three moderate findings in the existing `@fastify/static`, `glob`, and `minimatch` chain; dependency remediation remains separate.

## Phase 4A - Finding creation backend (merged, PR #14)

- Added session-authenticated finding creation, project permission and issue metadata checks, user-scoped recent history, a bounded per-site queue, and idempotency records. Requests require the Jira write grant and a unique idempotency key.
- Review fixed an SDK metadata mismatch with Atlassian's documented response and checks current resource write scopes even when the token response omits `scope`. Consumed metadata is validated before use. Uncertain outcomes remain blocked for manual review.
- All 30 host and Docker tests passed; the final Docker run used no network. Lint, build, and dependency audit passed. The final production image started healthy with six migrations on a fresh, network-isolated database. UI integration, the scanner API, and live Jira checks remain outstanding.
- The later main-integration check passed the 30-test network-isolated Docker suite and lint. A fresh production dependency audit reported three moderate findings involving `@fastify/static`, `glob`, and `minimatch`; these dependencies were not changed in this PR.

## Phase 3 — Jira refresh and project discovery (merged in PR #12)

- Added user-coordinated rotating refresh tokens, accessible-site selection, and project discovery. Failed or interrupted rotations require reconnection.
- The connection snapshot passed 29 host and Docker tests, including the site-change race test, plus lint and a Docker build. A network-isolated production container started healthy with five migrations on a fresh database. Tests used fake providers; Jira UI, finding creation, and live provider checks remain outstanding.

## Phase 3 — Token exchange and encrypted storage (merged in PR #11)

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
