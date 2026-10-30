# IdentityHub

IdentityHub is a work-in-progress proof of concept for reporting non-human identity findings to Jira. The current version provides accounts, server-side sessions, a health endpoint, and Jira OAuth token exchange with encrypted storage. A usable Jira connection, ticket creation, API keys, and the AI digest are **not implemented or live-verified** yet.

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

The command builds the app and runs browser tests in two groups, each with a separate local server and temporary SQLite database. This also gives the verification group a fresh rate-limit state. The databases are removed afterward; the tests do not use the Docker volume or your local app database. A forced process termination or machine crash may leave a temporary `identityhub-e2e-` folder in the system temporary directory.

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
| `GET /api/jira/callback` | Validate state, exchange the code, and store encrypted credentials for the initiating user. |

Session-authenticated state-changing requests require the CSRF token. Sessions expire after 24 hours. Login and registration are rate-limited in memory; those limits reset on restart and are not shared across multiple instances. Duplicate registration reports that an email is already registered, which improves feedback but reveals whether an account exists. Login errors remain generic.

Authentication responses include `Cache-Control: no-store`. Session checks have a ten-second timeout; a newer focus or visibility check supersedes an older request. A temporary check failure keeps an unsent draft, while confirmed expiry or an account change clears it.

## Configuration and security

`.env` and database files are ignored by Git and excluded from Docker's build context. `.env.example` contains placeholders; `.env.mock` contains public fake values only. Never put real credentials in committed files or logs. For a deployed system, use a secrets manager or your hosting platform's secret configuration.

Passwords are stored as Argon2id hashes. Session cookies are HttpOnly and SameSite=Lax, and are marked Secure when `APP_BASE_URL` uses HTTPS. The cookie contains a random session identifier; only its hash is stored in SQLite. Security headers and request size limits are enabled. This is a single-instance proof of concept, not a production-ready deployment.

The account implementation does not use `SESSION_SECRET`; AI settings remain placeholders. The root `digest` command remains a placeholder.

## Local fake Atlassian service

Run `npm run mock:atlassian` from the project root. It listens only on `127.0.0.1:4010` and uses the callback `http://localhost:3000/api/jira/callback` by default. Set `OAUTH_REDIRECT_URI` in the shell to another local HTTP callback if needed. It accepts only that exact callback. The fake client ID is `mock-client-id`, secret is `mock-client-secret`, code is `fake-code`, and tokens are `fake-access-token` and `fake-refresh-token`; all are public test values.

The fake implements `/authorize`, `/oauth/token`, and `/oauth/token/accessible-resources`, following the request shapes in [Atlassian's OAuth guide](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/). It automatically grants consent, reuses a fixed code, and returns a single fake site. It does not implement refresh, real OAuth security, projects, or tickets; the app does not yet call it. Run it on the host: the existing Compose mock profile is not supported because the fake listens on loopback inside the container. `.env.mock` describes planned container addresses and is not loaded by this command.

The server uses the community `jira.js` SDK for OAuth. Tests inject a fake transport and never contact a provider. The standalone fake is not automatically wired into the application.

The start endpoint requires `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, and `ENCRYPTION_KEY` in the server environment; missing or invalid configuration returns 503. Generate a unique 32-byte key as base64 with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and keep it in ignored local configuration or a secret store. Back it up securely: changing or losing the key makes existing credentials unreadable. The callback URL must be HTTPS or loopback HTTP, without credentials, query, or fragment. Local development does not load `.env` automatically; Docker Compose does.

The SDK uses Atlassian's fixed authorization and token hosts. `ATLASSIAN_AUTH_BASE` and `ATLASSIAN_AUTH_BROWSER_BASE`, if set, must both be `https://auth.atlassian.com`; other values disable the flow with 503 rather than silently contacting Atlassian. In particular, `.env.mock` is not a runnable integration configuration. Tests route to the fake with an injected transport, not these environment variables.

The start endpoint requests `read:jira-work` and `offline_access` and creates single-use state valid for ten minutes. A successful callback exchanges the code and stores tokens encrypted using AES-256-GCM, bound to the authenticated user. It does not return tokens. A failed exchange consumes the state and requires a new attempt. Only one token exchange per user can run at a time in this single-instance app. Refresh, project discovery, and UI integration are not implemented; do not perform live OAuth until those pieces are ready. Request logs omit query strings to avoid recording callback codes and state. Atlassian documents [the exchange and offline scope](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/).

## Project structure and next steps

- `web/src/App.tsx` coordinates the account view, `AuthForm.tsx` handles form interaction and validation, and `authApi.ts` contains API requests.
- `server/src/routes/` handles HTTP and CSRF checks; `server/src/services/` contains authentication logic; `server/src/db/` contains the SQLite connection and authentication repository; `server/migrations/` defines the database schema.
- [Build plan](docs/BUILD_PLAN.md), [system design](docs/SYSTEM_DESIGN.md), and [trade-offs](docs/tradeoffs.md) describe the planned work and decisions. [Changelog](CHANGELOG.md) records completed phases.

Next phases add Jira OAuth and a fake Atlassian server, findings and the recent list, API keys and the external API, and the AI digest. Real Jira and AI checks require the owner to configure credentials and run them manually. Scheduling, automatic reconciliation, roles and teams, and production infrastructure are outside the current scope.

## UI foundation

The signed-in interface includes a responsive account shell and an accessible account menu. Jira connection and ticket features remain unavailable. The Radix Dropdown Menu dependency provides the account menu's keyboard and focus behavior; the interface uses custom CSS. The [build plan](docs/BUILD_PLAN.md) groups the UI and backend review as phase 2 and plans Jira connection for phase 3.

The Findings view shows an unavailable ledger until Jira is implemented. The reporting view holds a temporary draft in memory only; it cannot create a ticket. Leaving with a nonempty draft prompts for confirmation. Browsers control the reload or tab-close warning and may suppress it, especially on mobile. Drafts are lost on reload or process termination. Views do not create browser history entries or support deep links.

Settings contains planned Jira connection and API access panels; those services remain unavailable. Session checks on focus or visibility changes retain drafts on temporary failures and clear them on confirmed expiry or account changes. If sign-out fails, the application does not claim the server session ended.

The project-local Fastify reference and the current authentication review are described in [the backend review](docs/BACKEND_REVIEW.md). Its third-party examples are guidance, subject to this project's security and design decisions.
