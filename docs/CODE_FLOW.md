# Code flow and entry points

This guide describes the implementation on this branch. Follow the links to the implementation for exact validation and error handling. [System design](SYSTEM_DESIGN.md) explains the boundaries and trade-offs; [onboarding](ONBOARDING.md) explains how to run it.

## Startup and request handling

1. [`server/src/index.ts`](../server/src/index.ts) calls `buildApp()` and listens on `PORT`.
2. [`buildApp`](../server/src/app.ts) opens SQLite, installs cookie, security, rate-limit and CSRF handling, constructs services, registers routes, and serves the built web app when present.
3. [`openDatabase`](../server/src/db/database.ts) enables foreign keys and applies the ordered, not-yet-applied SQL migrations in a transaction per migration. Closing the app closes the database.
4. [`web/src/main.tsx`](../web/src/main.tsx) mounts the React app. [`App.tsx`](../web/src/App.tsx) loads the session and switches between authentication and the user-keyed workspace.

## Account and session

1. [`AuthForm`](../web/src/AuthForm.tsx) calls `authenticate` in [`authApi.ts`](../web/src/authApi.ts); `authRoutes` in [`routes/auth.ts`](../server/src/routes/auth.ts) validates credentials and applies rate limits.
2. [`AuthService.register` and `login`](../server/src/services/auth.ts) hash or verify the password and create or replace the session through [`AuthRepository`](../server/src/db/authRepository.ts). Login returns the CSRF token and sets an HttpOnly session cookie; the database holds a hash of the session identifier.
3. `AuthService.session`, `validCsrf`, and `logout`, together with [`csrfGuard`](../server/src/routes/csrf.ts), resolve the active identity, protect state-changing requests, and invalidate the session on logout. The browser rechecks identity on focus and visibility changes; confirmed account changes clear user-bound state.

## Connect Jira and select a destination

1. [`Settings`](../web/src/Settings.tsx) and [`jiraApi.ts`](../web/src/jiraApi.ts) call [`jiraRoutes`](../server/src/routes/jira.ts). The authenticated connect request requires CSRF.
2. [`JiraOAuth.start`](../server/src/jira/oauth.ts) binds an expiring state to the session. The callback consumes state and `exchangeAndStore` exchanges the code and saves encrypted tokens. [`tokenExchange.ts`](../server/src/jira/tokenExchange.ts) guards provider requests; [`credentials.ts`](../server/src/jira/credentials.ts) encrypts and decrypts tokens.
3. [`JiraConnection.sites`, `select`, `clientFor`, and `projects`](../server/src/jira/connection.ts) check accessible sites, persist the user’s selection, obtain a usable token, and discover projects. `JiraOAuth.getAccessToken` coordinates refresh and fails closed on uncertain rotation.
4. [`Shell.tsx`](../web/src/Shell.tsx) controls readiness and destination state.

## Finding from the web

1. [`FindingComposer`](../web/src/FindingComposer.tsx) validates the draft and submits through [`findingApi.ts`](../web/src/findingApi.ts), with the expected site, CSRF token, and an idempotency key. The draft is held in memory.
2. [`findingsRoutes`](../server/src/routes/findings.ts) validates and authenticates the request. [`FindingsService.create`](../server/src/jira/findings.ts) checks the selected site, project and Jira create metadata, reserves the operation, sends the issue through a bounded per-site queue, and records the result. `recent` returns locally recorded issues scoped to the user, site, and project.
3. A definite rejection can be handled as such; an unknown result blocks automatic replay and requires checking Jira. If Jira confirms creation but local recording fails, check Jira before any new attempt. The same service handles scanner and digest creation.

## API keys and scanner

1. [`ApiKeyPanel`](../web/src/ApiKeyPanel.tsx) and [`apiKeyApi.ts`](../web/src/apiKeyApi.ts) call [`apiKeyRoutes`](../server/src/routes/apiKeys.ts).
2. [`ApiKeyService.create`, `list`, and `revoke`](../server/src/services/apiKeys.ts) manage keys for the session user and selected site. The secret is displayed once; only its hash and identifying metadata are stored. Project IDs and keys form the allowlist.
3. [`scannerRoutes`](../server/src/routes/scanner.ts) validates the request and calls `ApiKeyService.authenticate`. The authenticated key determines the user and allowed destination, then `FindingsService.create` rechecks access and revocation. Scanner idempotency is scoped to the API key; a request without an idempotency key is a new operation.

## Blog discovery and digest

1. [`discover:blog`](../server/src/digest/discover-cli.ts) calls `discoverOasis` / `discoverLatest` in [`discovery.ts`](../server/src/digest/discovery.ts). The code checks robots.txt, parses the sitemap and visible publication metadata, and selects the latest day with a deterministic tie-breaker.
2. `fetchOasisArticle` checks the selected article again; [`extractArticleText`](../server/src/digest/article.ts) extracts bounded text. [`previewLatestSummary`](../server/src/digest/preview.ts) passes it to the configured summarizer without creating a ticket.
3. [`digest/cli.ts`](../server/src/digest/cli.ts) loads the configured account, database, project and optional summarizer. [`runDigest`](../server/src/digest/command.ts) discovers and summarizes the article, uses an extractive fallback when permitted, and returns a dry run or reserves a user/post before calling `FindingsService.create`.
4. [`createOpenAiSummarizer`](../server/src/ai/openai.ts) calls the Responses API; [`createCodexSummarizer`](../server/src/ai/codex.ts) invokes the local Codex CLI for dry runs only. Both validate inputs and outputs; review summaries for accuracy. Codex can access files permitted by its sandbox before a tool event is rejected.
5. Done reservations prevent duplicate digests; pending or unknown outcomes require manual investigation. Dry runs do not reserve or write, though opening SQLite can apply migrations.

## Tests and changes

Server tests under [`server/test`](../server/test) inject fake providers; [`e2e`](../e2e) drives the browser against isolated temporary databases and fake Jira. [`scripts/e2e.mts`](../scripts/e2e.mts) orchestrates browser groups. Follow [verification boundaries](../README.md#tests-and-checks) before claiming a real integration works. For schema changes, inspect migrations, user scoping, and failure/replay handling together.
