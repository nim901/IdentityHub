# Onboarding and configuration

These examples use a Linux shell from the repository root. For the architecture and important functions, see [system design](SYSTEM_DESIGN.md) and [code flow](CODE_FLOW.md). Automated tests use fake providers; do not put real credentials in tests, logs, Git, or fixtures.

## Get running

1. Install Docker Engine with Compose, or Node.js 22 and npm. Clone the repository and enter it:

   ```sh
   git clone https://github.com/nim901/IdentityHub.git
   cd IdentityHub
   ```

2. Create the ignored configuration file only if it does not already exist:

   ```sh
   test -e .env || cp .env.example .env
   chmod 600 .env
   ```

3. For the basic account flow, leave Jira and AI values blank and start the app:

   ```sh
   docker compose up --build
   ```

   Open [localhost:3000](http://localhost:3000), register with a password of at least 12 characters, and sign in. Check [healthz](http://localhost:3000/healthz). No Jira account or AI key is required for registration and login. Compose runs migrations at startup and keeps SQLite in its `app-data` volume. `docker compose down` preserves the volume; `docker compose down -v` deletes it.

4. For development without Docker:

   ```sh
   npm ci
   npm run dev:server
   ```

   In another terminal, run `npm run dev:web` and open the Vite URL, normally [localhost:5173](http://localhost:5173). Local npm commands do **not** load `.env` automatically. Export values in the appropriate process environment or, for a built command, use Node's `--env-file=.env`. Restart the process after changing its configuration. Vite reads `IDENTITYHUB_API_TARGET` in its own terminal. The default local database is relative to the process working directory; use an absolute `DATABASE_PATH` to avoid ambiguity.

## Configuration files and loading

| File | Purpose and loading |
| --- | --- |
| `.env.example` | Tracked template with empty provider credentials and example settings. Copy it to `.env`; do not add real credentials to the template. |
| `.env` | Ignored private local configuration. Docker Compose uses it for interpolation and passes it into the app through `env_file`; shell commands and npm scripts do not automatically read it. Restrict access and back it up securely when it contains secrets. |
| `.env.mock` | Tracked public fake values from earlier groundwork; it is not loaded automatically and is not a working app-to-fake configuration. Non-default Atlassian auth URLs disable the real integration. The standalone fake listens on host loopback and does not implement projects or tickets. |
| `compose.yaml` | Local app, persistent volume, health check, and test/mock profiles. The app's `DATABASE_PATH=/data/app.db` overrides a value in `.env`. The container mock profile is unsupported because the fake listens on container loopback. |

Never replace an existing `.env` without checking it first. Back up the database and its matching encryption key together; changing or losing that key makes saved Jira credentials unreadable.

## Variables

Set only values needed by the features you use. Examples are illustrative, not credentials.

| Variable | Purpose and how to fill it |
| --- | --- |
| `APP_BASE_URL` | Origin used to decide whether the session cookie is Secure. Use `http://localhost:3000` locally; set the public HTTPS origin behind TLS. |
| `PORT` | API listen port; defaults to `3000`. Compose publishes host port 3000 to container port 3000, so changing the container port also requires matching port mapping and health check configuration. |
| `DATABASE_PATH` | SQLite file path; defaults to `app.db` relative to the process working directory. For example, export `DATABASE_PATH="$PWD/server/app.db"` for a host digest using the development server's default database. Compose forces `/data/app.db`; |
| `SESSION_SECRET` | Present in the template for historical compatibility; the current account implementation does not use it. |
| `ENCRYPTION_KEY` | Stable, private base64 encoding of 32 random bytes used for Jira token encryption. Generate once with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`, put the output in private `.env`, and back it up securely. Required for Jira, not account-only use. |
| `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` | Client ID and secret from your Atlassian OAuth 2.0 (3LO) app's developer-console settings. Both are required for Jira; keep the secret private. |
| `OAUTH_REDIRECT_URI` | Exact callback registered with that OAuth app, e.g. `http://localhost:3000/api/jira/callback`. It must use HTTPS or loopback HTTP and have no query, fragment, or embedded credentials. |
| `ATLASSIAN_AUTH_BASE`, `ATLASSIAN_AUTH_BROWSER_BASE` | Optional compatibility checks. Leave unset or set both to `https://auth.atlassian.com`; other values disable the Jira flow. They do not configure a fake provider. |
| `ATLASSIAN_API_BASE` | Present in `.env.example` and `.env.mock`, but current application code does not read it; Jira uses fixed provider endpoints. |
| `JIRA_DEFAULT_ISSUE_TYPE` | Optional preferred supported Jira issue type name, e.g. `Task`. If unset, the app prefers a supported Task and otherwise selects a supported type. Unsupported required fields can still prevent creation. |
| `DIGEST_USER_EMAIL` | Email of an existing IdentityHub user whose account runs the local digest, e.g. `you@example.com`. Required even for dry runs. The operator must have access to that user's database. |
| `DIGEST_PROJECT_KEY` | Uppercase Jira project key, e.g. `SEC`. Required even for dry runs; a real write requires that project to be accessible through the user's selected site. |
| `AI_MODEL` | Model identifier available to your OpenAI API project. Required with `AI_API_KEY` for the Responses API summary preview or API-backed digest. Choose a supported model for your account. |
| `AI_API_KEY` | Secret OpenAI API project key for the Responses API adapter. Create one in the [OpenAI API platform](https://platform.openai.com/api-keys), keep it private, and check project access and billing. This app reads `AI_API_KEY`, not `OPENAI_API_KEY`. |
| `IDENTITYHUB_API_TARGET` | Vite development server only; defaults to `http://127.0.0.1:3000`. Example: `IDENTITYHUB_API_TARGET=http://127.0.0.1:3001 npm run dev:web`. |
| `AI_PROVIDER`, `AI_BASE_URL` | Legacy entries in `.env.mock`; current application code does not read them. The OpenAI adapter uses a fixed endpoint. |

The browser test harness supplies its own `E2E_JIRA_SCENARIO`, `E2E_FAKE_REQUEST_LOG`, database, and ports. These are test controls, not normal deployment settings. Codex CLI also uses its own login and local configuration; the digest adapter passes only a small environment allowlist to the child process.

## Connect Jira

1. In the [Atlassian developer console](https://developer.atlassian.com/console/myapps/), create an OAuth 2.0 (3LO) app, enable Jira API access and add the classic `read:jira-work` and `write:jira-work` scopes. IdentityHub also requests `offline_access` for refresh. Register the exact callback URL you will use. See [Atlassian's 3LO guide](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/) and [scope reference](https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/).
2. Fill `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, and the generated `ENCRYPTION_KEY` in your private environment. For Compose, restart or recreate the app after editing `.env`. For host development, export the values before starting the API. Build the web app and open the API origin for the callback.
3. Sign in to IdentityHub, open Settings, connect Jira and grant access, then select a site. In Findings, choose an accessible project. The Jira user must have appropriate project permissions; scopes do not grant permissions the user lacks. Creating a finding writes a real Jira issue.

## Run a digest preview

Build first, and point the command at an existing database and account. These shell exports are examples; replace them with your values:

```sh
npm run build
export DATABASE_PATH="$PWD/server/app.db"
export DIGEST_USER_EMAIL='you@example.com'
export DIGEST_PROJECT_KEY='SEC'
npm run digest -- --dry-run
```

Without an API summarizer this uses a labeled extractive fallback and exits 3. To require an API summary, set both `AI_MODEL` and `AI_API_KEY`, then run `npm run digest -- --dry-run --require-ai`; article text is sent to OpenAI and charges may apply. For a ChatGPT-authenticated Codex CLI preview, see the [README example](../README.md#digest-command): `--codex-cli` is host-only and requires `--dry-run`. A dry run does not write to Jira or reserve a digest, but may run database migrations. Live non-dry commands can create Jira issues; verify them manually with owner-controlled credentials.

## Checks and where to look next

Run `npm test`, `npm run lint`, `npm run build`, and `npx playwright install chromium` followed by `npm run test:e2e` as appropriate. The browser suite uses isolated temporary databases and fake Jira; it does not verify real providers. See [README tests](../README.md#tests-and-checks), [code flow](CODE_FLOW.md), [system design](SYSTEM_DESIGN.md), [trade-offs](tradeoffs.md), and [changelog](../CHANGELOG.md).
