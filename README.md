# IdentityHub

IdentityHub is a work-in-progress proof of concept for reporting non-human identity findings to Jira. The current version provides accounts, server-side sessions, a health endpoint, and Jira OAuth, encrypted rotating credentials, site and project discovery, and a session-authenticated finding-to-Jira API. The Jira connection, site and project selection, finding form, and recent-ticket UI are implemented; API key management is implemented; the scanner endpoint and AI digest command are implemented. The owner has completed a live OAuth callback and saved a Jira site; live project discovery and ticket creation remain unverified.

## Requirements

- Docker Desktop (or Docker Engine with the Compose plugin) for the recommended setup.
- Alternatively, Node.js 22 and npm for local development. Native dependencies may require platform build tools if prebuilt packages are unavailable.
- Ports 3000 (API and Docker app) and 5173 (Vite development server) must be free.

No Jira account or AI provider key is needed for the current account flow.

## Run with Docker

From the project root, create a local environment file if you do not already have one:

```sh
cp .env.example .env
```

On PowerShell, use `Copy-Item .env.example .env` instead. Do not overwrite an existing `.env`: it may contain your settings. The example values are sufficient for the current local account flow; Jira requires separate configuration and AI settings are placeholders. Do not use example secrets for a real deployment.

Start the application:

```sh
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000), create an account with an email address and a password of at least 12 characters, then sign in. The health endpoint is [http://localhost:3000/healthz](http://localhost:3000/healthz). Migrations run when the server starts. SQLite data persists in the `app-data` Docker volume.

Stop the app with Ctrl+C, then run `docker compose down` if you want to remove the containers and network. This preserves the database volume. **`docker compose down -v` deletes the database volume and all accounts and session data**; use it only if you intend to reset the data.

## Run locally for development

From the project root:

```sh
npm ci
```

Start the API and web development servers in separate terminals:

```sh
npm run dev:server
```

```sh
npm run dev:web
```

Open the address printed by Vite, normally [http://localhost:5173](http://localhost:5173). Vite proxies API requests to port 3000 using IPv4. If the API runs on a different port, set `IDENTITYHUB_API_TARGET` in the web terminal to its URL before starting Vite. The local API defaults to a SQLite file named `app.db` in the server workspace; set `DATABASE_PATH` in the server process environment to choose another location. The local development command does **not** automatically load `.env`; export variables in the shell when needed. For example, in PowerShell:

```powershell
$env:DATABASE_PATH = 'C:\path\to\app.db'
$env:APP_BASE_URL = 'http://localhost:3000'
npm run dev:server
```

`APP_BASE_URL` controls whether session cookies have the `Secure` flag; use HTTPS and an `https://` value when deploying behind TLS. The current server defaults to port 3000 if `PORT` is unset. To run the built application locally, run `npm run build` followed by `npm start` from the project root.

## Tests and checks

```sh
npm test
npm run lint
npm run build
npm audit
```

Browser end-to-end tests require the Playwright Chromium browser (install once):

```sh
npx playwright install chromium
npm run test:e2e
```

The command builds the app and runs browser tests in nine groups, each with a separate local server and temporary SQLite database. Each group gets a fresh rate-limit state. The browser server uses fake Jira configuration and transport, including separate missing-configuration, invalid-key, and failed-exchange scenarios. It clears inherited Jira credentials and rejects unexpected provider requests. The databases are removed afterward; the tests do not use the Docker volume or your local app database. A forced process termination or machine crash may leave a temporary `identityhub-e2e-` folder in the system temporary directory.

To run tests inside Docker, including rebuilding the test image after changes:

```sh
docker compose --profile test run --build --rm test
```

Server tests use an in-memory SQLite database and run one test file at a time, with a 15-second default timeout to accommodate real password hashing on slower machines. This affects test execution only; password security settings are unchanged. Browser tests use a temporary database file. Neither calls Jira, Oasis, or a model provider. A passing fake-service test will not by itself verify real provider behavior.

## Current API

| Method and path | Purpose |
| --- | --- |
| `GET /healthz` | Check server health. |
| `POST /api/auth/register` | Register using JSON `email` and `password`. |
| `POST /api/auth/login` | Sign in and receive a session cookie and CSRF token. |
| `GET /api/auth/session` | Get the current user and CSRF token. |
| `POST /api/auth/logout` | Sign out; include the `X-CSRF-Token` header. |
| `POST /api/jira/connect` | Start an authenticated, CSRF-protected OAuth request and return its authorization URL. |
| `GET /api/jira/callback` | Validate state, exchange the code, store encrypted credentials, and redirect to the app with a safe outcome. |
| `GET /api/jira/status` | Read the signed-in user's saved connection and selected-site status. |
| `GET /api/jira/sites`, `POST /api/jira/site` | List accessible Jira sites and select one (JSON `id`). |
| `GET /api/jira/projects` | List projects in the selected site. |
| `GET /api/keys` | List the signed-in user's API key metadata. |
| `POST /api/keys` | Create a site- and project-restricted key; returns the secret once and requires CSRF. |
| `DELETE /api/keys/:id` | Revoke the signed-in user's key; requires CSRF. |
| `POST /api/v1/findings` | Create a finding as an external scanner using `X-API-Key`; optionally supply an `Idempotency-Key`. |
| `POST /api/findings` | Create a ticket from `project`, `title`, and `description`; accepts an optional expected `siteId` and requires a unique 16–128 character `Idempotency-Key` and CSRF token. |
| `GET /api/findings?project=KEY` | Return up to ten of the signed-in user's locally recorded tickets. An optional `siteId` binds the request to the expected site. |

Session-authenticated state-changing requests require the CSRF token. Sessions expire after 24 hours. Login and registration are rate-limited in memory; those limits reset on restart and are not shared across multiple instances. Duplicate registration reports that an email is already registered, which improves feedback but reveals whether an account exists. Login errors remain generic.

Authentication responses include `Cache-Control: no-store`. Session checks have a ten-second timeout; a newer focus or visibility check supersedes an older request. A temporary check failure keeps an unsent draft, while confirmed expiry or an account change clears it.

## Configuration and security

`.env` and database files are ignored by Git and excluded from Docker's build context. `.env.example` contains placeholders; `.env.mock` contains public fake values only. Never put real credentials in committed files or logs. For a deployed system, use a secrets manager or your hosting platform's secret configuration.

Passwords are stored as Argon2id hashes. Session cookies are HttpOnly and SameSite=Lax, and are marked Secure when `APP_BASE_URL` uses HTTPS. The cookie contains a random session identifier; only its hash is stored in SQLite. Security headers and request size limits are enabled. This is a single-instance proof of concept, not a production-ready deployment.

The account implementation does not use `SESSION_SECRET`. The digest command and read-only summary preview are described below.

## Local fake Atlassian service

Run `npm run mock:atlassian` from the project root. It listens only on `127.0.0.1:4010` and uses the callback `http://localhost:3000/api/jira/callback` by default. Set `OAUTH_REDIRECT_URI` in the shell to another local HTTP callback if needed. It accepts only that exact callback. The fake client ID is `mock-client-id`, secret is `mock-client-secret`, code is `fake-code`, and tokens are `fake-access-token` and `fake-refresh-token`; all are public test values.

The fake implements `/authorize`, `/oauth/token`, and `/oauth/token/accessible-resources`, following the request shapes in [Atlassian's OAuth guide](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/). It automatically grants consent, reuses a fixed code, and returns a single fake site. It does not implement refresh, real OAuth security, projects, or tickets; the app does not yet call it. Run it on the host: the existing Compose mock profile is not supported because the fake listens on loopback inside the container. `.env.mock` describes planned container addresses and is not loaded by this command.

The server uses the community `jira.js` SDK for OAuth. Tests inject a fake transport and never contact a provider. The standalone fake is not automatically wired into the application.

The start endpoint requires `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, and `ENCRYPTION_KEY` in the server environment; missing or invalid configuration returns 503. Generate a unique 32-byte key as base64 with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and keep it in ignored local configuration or a secret store. Back it up securely: changing or losing the key makes existing credentials unreadable. The callback URL must be HTTPS or loopback HTTP, without credentials, query, or fragment. Local development does not load `.env` automatically; Docker Compose does.

The SDK uses Atlassian's fixed authorization and token hosts. `ATLASSIAN_AUTH_BASE` and `ATLASSIAN_AUTH_BROWSER_BASE`, if set, must both be `https://auth.atlassian.com`; other values disable the flow with 503 rather than silently contacting Atlassian. In particular, `.env.mock` is not a runnable integration configuration. Tests route to the fake with an injected transport, not these environment variables.

The start endpoint requests `read:jira-work`, `write:jira-work` and `offline_access` and creates single-use state valid for ten minutes. A successful callback exchanges the code and stores tokens encrypted using AES-256-GCM, bound to the authenticated user. It does not return tokens. A failed exchange consumes the state and requires a new attempt. Only one token exchange per user can run at a time in this single-instance app. Refresh rotation and project discovery are implemented. Settings starts the connection and selects a site; the findings workspace can select a discovered project. Existing grants without the write scope must reconnect. Live OAuth is available when configured; the owner has completed a live OAuth callback; further live verification remains outstanding, and automated tests use only fakes. Request logs omit query strings to avoid recording callback codes and state. Atlassian documents [the exchange and offline scope](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/).

## Project structure and next steps

- `web/src/App.tsx` coordinates the account view, `AuthForm.tsx` handles form interaction and validation, and `authApi.ts` contains API requests.
- `server/src/routes/` handles HTTP and CSRF checks; `server/src/services/` contains authentication logic; `server/src/db/` contains the SQLite connection and authentication repository; `server/migrations/` defines the database schema.
- [Build plan](docs/BUILD_PLAN.md), [system design](docs/SYSTEM_DESIGN.md), and [trade-offs](docs/tradeoffs.md) describe the planned work and decisions. [Changelog](CHANGELOG.md) records completed phases.

The next phase is owner-run live verification of the Jira and digest flows. Real Jira and AI checks require the owner to configure credentials and run them manually. Scheduling, automatic reconciliation, roles and teams, and production infrastructure are outside the current scope.

## UI foundation

The signed-in interface includes a responsive account shell and an accessible account menu. The Jira connection, site and project selection, ticket creation, and recent history are connected to the API. The Radix Dropdown Menu dependency provides the account menu's keyboard and focus behavior; the interface uses custom CSS. The [build plan](docs/BUILD_PLAN.md) groups the UI and backend review as phase 2 and plans Jira connection for phase 3.

The Findings view shows up to ten app-created tickets for the selected project. The reporting view keeps its draft in memory until submission and creates a Jira ticket through the API. Leaving with a nonempty draft prompts for confirmation. Browsers control the reload or tab-close warning and may suppress it, especially on mobile. Drafts are lost on reload or process termination. Views do not create browser history entries or support deep links.

Recent tickets refresh when returning to Findings; use **Refresh** to reload the selected project's list while staying on the page. The control is unavailable until the Jira destination and session are ready. The list contains only issues recorded by IdentityHub.

Settings supports Jira connection and site selection when the server is configured. When configuration is missing or invalid, the connection button remains disabled and setup guidance identifies the required server variables. A failed project lookup offers a retry. API key management can create, list, and revoke project-restricted keys; the scanner endpoint accepts these keys. Session checks on focus or visibility changes retain drafts on temporary failures and clear them on confirmed expiry or account changes. If sign-out fails, the application does not claim the server session ended.

The project-local Fastify reference and the current authentication review are described in [the backend review](docs/BACKEND_REVIEW.md). Its third-party examples are guidance, subject to this project's security and design decisions.

## Jira backend limitations

The application is designed for one server instance. Refreshes for one user share a single in-process operation. Before sending a refresh, the database marks the old token as in use; an interrupted or failed refresh requires reconnecting instead of reusing a possibly rotated token. Requests do not automatically retry Jira writes. A pending or unknown ticket operation requires checking Jira before any new attempt: a different key can create a duplicate. These records are not automatically reconciled.

The selected site must be an accessible `*.atlassian.net` HTTPS site. Project and create-field metadata are checked before ticket creation; projects requiring unsupported mandatory fields cannot be used. `JIRA_DEFAULT_ISSUE_TYPE` optionally prefers a supported issue type by name; otherwise a supported Task is preferred. The recent list is local app-created history, not a live Jira query, and uses the local recorded creation time. Configured grants need Jira's create permission and the write scope. An expired token is refreshed before use; a provider 401 for an otherwise unexpired token currently requires reconnecting.

Provider responses are bounded, timed out and restricted to fixed Atlassian endpoints with redirects rejected. The bounded queue limits concurrent creates, but there is no per-user creation rate limit yet. Automated tests inject a fake transport; they do not establish real Jira compatibility. The standalone fake remains limited to the earlier OAuth groundwork and cannot exercise projects or ticket creation.

For a local OAuth callback, open the app served by the API at port 3000 (build the web app first). The callback returns to that origin. Select an accessible site in Settings and then a project in Findings. The selected project is held in memory. Creation uses an idempotency key, and recent history is scoped to the signed-in user and selected project. The browser sends its expected site ID with finding and history requests; the API rejects a changed site. For compatibility, older API callers may omit the site ID and then use the currently selected site. Saved connection status does not guarantee the provider still grants access; reconnect if discovery fails.

Finding submissions are never silently retried. If the outcome is unknown, check Jira before attempting another creation; an explicit acknowledgment is required before resubmitting from the current draft. Drafts and that acknowledgment do not survive reloads. The history page shows only tickets recorded by IdentityHub, so an issue whose local recording failed may be absent.

## API key management

In Settings → API access, connect Jira and select a site, name a key, and select one to twenty accessible projects. The secret is shown only once; copy it before leaving the panel. IdentityHub stores a SHA-256 hash and a short identifying prefix, not the full key. Keys are bound to the selected site, user, and discovered Jira project IDs as well as their display keys; they can be revoked even after the Jira connection is lost. If creation cannot be confirmed, check the list and revoke an unwanted key before trying again. Navigation is disabled during creation and browsers are asked to warn before unloading; browsers may suppress that warning. The list shows up to 100 keys, with active keys first; at most 20 keys may be active.

The scanner endpoint enforces the stored user, site, project IDs, and revocation. It rejects older records that lack project IDs until those keys are replaced. Existing records without project IDs remain listable and revocable and are labelled “Needs replacement.” The new SQLite migrations are applied on server startup, including in the existing Docker setup; no new configuration variables are required. Docker build and runtime behavior remain unverified in this environment.


## Scanner API

`POST /api/v1/findings` accepts `X-API-Key` and JSON with `project`, `title`, and `description`; `type`, `severity`, and `resource` are optional text added to the Jira description. The key must belong to an active user connection and permit the selected site and discovered project ID. A key without project IDs must be replaced. See [the OpenAPI description](docs/scanner-openapi.yaml) for limits and response codes.

Send the API key only over HTTPS and keep it out of logs and source control. Send an `Idempotency-Key` (16–128 letters, digits, `.`, `_`, `~`, or `-`) and retain it with the original request. A successful replay returns 200; different normalized fields or an unresolved prior outcome return 409. Idempotency is scoped to the API key, so changing keys does not preserve replay protection. If the outcome is unknown, check Jira before taking further action; the app never automatically repeats an uncertain write. Without the optional header, each request is a new operation and retries can create duplicates. Rate limiting is 30 requests per minute per source IP in one server process. No new environment variables or Docker settings are needed. Automated tests use fake providers; owner-run live scanner verification and Docker verification remain outstanding.


## Read-only blog discovery

After `npm run build`, run `npm run discover:blog` to inspect the sitemap published in [Oasis robots.txt](https://www.oasis.security/robots.txt). It first checks robots.txt conservatively and prints JSON with the chosen URL, visible heading, publication date, and `sameDayCount`. It does not call an AI provider or create a Jira ticket.

Oasis article pages inspected on 2026-10-31 show a visible “Published on” date and heading. Some JSON-LD `datePublished` values match later updates rather than the visible publication date, so discovery uses the visible date. Dates have day precision: it selects the latest day and uses the URL as a deterministic tie-breaker; `sameDayCount` reports how many posts share that date, without claiming which was published first within the day.

The command stops if robots.txt contains a nonempty disallow or nonzero crawl delay in any group, lacks a wildcard user-agent, no longer advertises the expected sitemap, or includes unsupported directives. This conservative policy can stop for restrictions intended for other crawlers. The library follows only allowed HTTPS sitemap and blog URLs, rejects redirects and DTDs, and fails if traversal or article metadata is incomplete. Limits are 8 sitemaps, 5,000 entries per sitemap, 250 blog posts, 1 MiB per response, and 10 seconds per request. Requests are serialized within one process with at least 500 ms between them; a timeout disables discovery in that process until restart. An optional in-memory metadata cache lasts at most one hour when sitemap `lastmod` is unchanged and can be stale if the site changes without changing `lastmod`. Cached entries with mismatched URLs or invalid titles or dates are ignored and refetched; only trusted application code should populate the cache. The command creates a fresh cache each run. No article text is stored. On 2026-10-31, an authorized read-only crawl of the sitemap and 110 blog pages completed before the robots check was added; automated tests of the final robots check use fakes.

The `saxes` and `parse5` dependencies parse untrusted XML and HTML. Automated tests inject fake transports and never contact Oasis. Docker uses the existing install and build steps with no new configuration; its build and runtime remain unverified here.


## Read-only summary preview

After `npm run build`, set `AI_MODEL` and `AI_API_KEY` in the shell and run `npm run preview:blog`. Local commands do not load `.env` automatically. Docker Compose loads `.env` into its app container. The command discovers the latest publication day, fetches the selected article, and sends bounded article text to the OpenAI Responses API. It prints metadata and a plain-text summary as JSON; it does not create a Jira issue. This sends article content to OpenAI and may incur API charges. Never commit the API key.

The body extractor requires exactly one `div` with both `blog-rich-text` and `w-richtext` classes. An authorized read-only inspection of one Oasis article confirmed this markup; automated tests use synthetic fixtures. Missing or ambiguous bodies fail closed. Before summarization, the refetched article must still have the title and publication date selected during discovery; body changes with unchanged metadata cannot be detected. The model receives no tools and is instructed to treat the article as untrusted input; this reduces risk but does not guarantee resistance to prompt injection or hallucination. Responses are not stored through the API (`store: false`); article text is not persisted by IdentityHub. Validate summaries before use. The preview fails on model errors or invalid output; degraded fallback and Jira creation are later work.

The adapter currently uses an OpenAI API key. Eligible ChatGPT Pro or Business owners may be able to link their subscription to an API organization and use [subscription API credits](https://developers.openai.com/api/docs/guides/chatgpt-api-credits). OpenAI also documents [ChatGPT plan authorization for eligible open-source apps](https://developers.openai.com/siwc/token-sharing-open-source); IdentityHub does not yet implement that separate sign-in flow.

The existing Docker runtime image includes the compiled preview, and Compose passes the configured environment into the app container. Container build and preview behavior have not been verified for this slice because Docker was unavailable.


## Digest command

After `npm run build`, configure `DATABASE_PATH` (default `app.db`), `DIGEST_USER_EMAIL`, and `DIGEST_PROJECT_KEY` in the process environment. The email must identify an existing IdentityHub account; a non-dry run also requires a connected Jira site, the existing Jira OAuth settings, and encryption key. Local commands do not automatically load `.env`. Set `AI_MODEL` and `AI_API_KEY` for OpenAI, or omit them to use an extractive fallback. The local operator controls which existing account runs the digest; restrict access to the database and environment.

Run `npm run digest -- --dry-run` to preview without creating a ticket or digest reservation. Run `npm run digest -- --require-ai` to fail if AI is unavailable. Without `--require-ai`, model failure yields a clearly labeled extractive fallback and exit code 3, including on a successful fallback ticket creation. Normal success and already-created results exit 0; errors exit 1. The command sends article text to OpenAI when configured and can create a real Jira issue unless `--dry-run` is supplied.

For a local preview using a ChatGPT-signed-in Codex CLI, install Codex and verify `codex login status` reports ChatGPT authentication. After building and configuring the digest user, project, and database path, run `node --env-file=.env server/dist/digest/cli.js --dry-run --codex-cli`. An existing IdentityHub account and valid project-key format are required; a Jira connection is not needed for a dry run. This option requires `--dry-run`, implies `--require-ai`, and does not use `AI_MODEL` or `AI_API_KEY`. It uses the CLI's default model and ChatGPT plan allowance, subject to limits or purchased credits. The Docker image does not include Codex; this option is supported on the host only.

Both providers are instructed to return a concise paragraph and up to five bullet points, attribute claims where appropriate, and avoid invented details and promotional language. This format is requested, not strictly enforced; summaries still require human review.

The CLI preview uses the same article discovery, instructions, and output validation as the API adapter, but it does not verify the Responses API request or model. Codex is an agent: its read-only sandbox may still allow access to local files, and tool events are rejected only after they occur. Treat article text as untrusted and run in a suitably isolated environment.

The command binds the write to the Jira site selected when the run started. The database reserves each user and post before a Jira write. Completed posts are not created twice, even if the selected project changes. A pending or uncertain reservation blocks retries and requires human investigation; a pending reservation older than 30 minutes is marked unknown on the next non-dry attempt; even some failures before a write are conservatively treated as uncertain. A definite Jira rejection or a confirmed site mismatch before the write releases the reservation. If Jira confirms an issue but local recording fails, the issue key is reported and retry remains blocked. No article body is stored in the digest table. SQLite migrations can run even on a dry run.

Docker Compose supplies `.env` and the persistent database volume to the app container. The command can be invoked inside that container with `npm run digest -- --dry-run`; container build and execution remain unverified on this machine because Docker is unavailable.
