# IdentityHub

IdentityHub is a work-in-progress proof of concept for reporting non-human identity findings to Jira. The current version provides account registration, sign-in and sign-out, server-side sessions, and a health endpoint. Jira integration, ticket creation, API keys, and the AI digest are planned but **not implemented or verified** yet.

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

On PowerShell, use `Copy-Item .env.example .env` instead. Do not overwrite an existing `.env`: it may contain your settings. The example values are sufficient for the current local account flow; Jira and AI settings are placeholders for later phases. Do not use the example secrets for a real deployment.

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

The command builds the app, starts a separate local server using a temporary SQLite database, runs the browser tests, and removes that database afterward. It does not use the Docker volume or your local app database. A forced process termination or machine crash may leave a temporary `identityhub-e2e-` folder in the system temporary directory.

To run tests inside Docker, including rebuilding the test image after changes:

```sh
docker compose --profile test run --build --rm test
```

Server tests use an in-memory SQLite database; browser tests use a temporary database file. Neither calls Jira, Oasis, or a model provider. A passing fake-service test in a future phase will not by itself verify real provider behavior.

## Current API

| Method and path | Purpose |
| --- | --- |
| `GET /healthz` | Check server health. |
| `POST /api/auth/register` | Register using JSON `email` and `password`. |
| `POST /api/auth/login` | Sign in and receive a session cookie and CSRF token. |
| `GET /api/auth/session` | Get the current user and CSRF token. |
| `POST /api/auth/logout` | Sign out; include the `X-CSRF-Token` header. |

Session-authenticated state-changing requests require the CSRF token. Sessions expire after 24 hours. Login and registration are rate-limited in memory; those limits reset on restart and are not shared across multiple instances. Duplicate registration reports that an email is already registered, which improves feedback but reveals whether an account exists. Login errors remain generic.

## Configuration and security

`.env` and database files are ignored by Git and excluded from Docker's build context. `.env.example` contains placeholders; `.env.mock` contains public fake values only. Never put real credentials in committed files or logs. For a deployed system, use a secrets manager or your hosting platform's secret configuration.

Passwords are stored as Argon2id hashes. Session cookies are HttpOnly and SameSite=Lax, and are marked Secure when `APP_BASE_URL` uses HTTPS. The cookie contains a random session identifier; only its hash is stored in SQLite. Security headers and request size limits are enabled. This is a single-instance proof of concept, not a production-ready deployment.

The environment example includes `SESSION_SECRET`, `ENCRYPTION_KEY`, Atlassian, and AI settings reserved for later phases; the current account implementation does not use them. The root `digest` and `mock:atlassian` commands are placeholders and cannot run until those features are implemented.

## Project structure and next steps

- `web/src/App.tsx` coordinates the account view, `AuthForm.tsx` handles form interaction and validation, and `authApi.ts` contains API requests.
- `server/src/routes/` handles HTTP and CSRF checks; `server/src/services/` contains authentication logic; `server/src/db/` contains the SQLite connection and authentication repository; `server/migrations/` defines the database schema.
- [Build plan](docs/BUILD_PLAN.md), [system design](docs/SYSTEM_DESIGN.md), and [trade-offs](docs/tradeoffs.md) describe the planned work and decisions. [Changelog](CHANGELOG.md) records completed phases.

Next phases add Jira OAuth and a fake Atlassian server, findings and the recent list, API keys and the external API, and the AI digest. Real Jira and AI checks require the owner to configure credentials and run them manually. Scheduling, automatic reconciliation, roles and teams, and production infrastructure are outside the current scope.

## UI foundation

The signed-in interface includes a responsive account shell and an accessible account menu. Jira connection and ticket features remain unavailable. The Radix Dropdown Menu dependency provides the account menu's keyboard and focus behavior; the interface uses custom CSS. Further workspace views are planned.

The Findings view shows an unavailable ledger until Jira is implemented. The reporting view holds a temporary draft in memory only; it cannot create a ticket. Leaving with a nonempty draft prompts for confirmation. Browsers control the reload or tab-close warning and may suppress it, especially on mobile. Drafts are lost on reload or process termination. Views do not create browser history entries or support deep links.
