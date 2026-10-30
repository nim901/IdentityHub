# Architecture trade-offs

These decisions favor a small take-home project that is easy to run and explain. They are choices for this scope, not universal rankings. Revisit them when requirements or evidence change.

## One repository rather than separate frontend and backend repositories

**Decision:** Keep `web/` and `server/` as separate workspaces in one repository. One clone, one dependency installation, and one Compose setup make the proof of concept easier to share, run, and review. The applications remain separate layers with an HTTP boundary.

**Trade-off:** Separate repositories could give frontend and backend teams independent ownership, access controls, release cycles, and deployment pipelines. They also add coordination around API changes, version compatibility, setup, and cross-repository changes. If the teams or release schedules become independent, splitting the repositories is a reasonable future choice.

## NestJS and full-stack Next.js

**NestJS:** [NestJS](https://docs.nestjs.com/exception-filters/faq/http-adapter) is a server-side framework, so it would be an alternative for the backend alongside a separate frontend, not a framework for both sides. Its modules, dependency injection, and conventions can help larger teams and applications; it can even use Fastify underneath. For this small proof of concept, direct Fastify plus explicit routes, services, and repositories gives us the needed separation with fewer framework concepts and dependencies to explain. If the backend grows substantially or the team already uses NestJS, its conventions could justify the additional structure.

**Next.js:** If the intended comparison is a single framework for frontend and backend, [Next.js](https://nextjs.org/docs) is a React full-stack framework with [route handlers](https://nextjs.org/docs/app/getting-started/route-handlers). It could simplify a unified web application, especially when server rendering or its routing features are useful. We chose React/Vite plus a separate Fastify API to keep the browser-to-API boundary explicit and straightforward to review for this assignment; the project does not currently need server rendering. The trade-off is maintaining two workspace build configurations and an API boundary that a unified framework could reduce. Neither choice is inherently more secure; security depends on the implementation.
## SQLite rather than MongoDB

**Decision:** Use SQLite with plain SQL migrations. The data is structured and related: users own sessions, Jira connections, keys, and ticket records. SQL constraints and transactions help enforce uniqueness and coordinate duplicate-prevention records. A file-backed database needs no separate database service, so a reviewer can start the application with less setup.

**Trade-off:** SQLite allows concurrent readers but one writer at a time. A single file and synchronous database driver suit a small, single-instance demonstration; sustained write load, multiple application instances, backups, and operational recovery need more thought. For a larger deployment, a managed client/server relational database such as PostgreSQL would be a natural next evaluation. See [SQLite's guidance on appropriate uses](https://www.sqlite.org/whentouse.html).

**Why not MongoDB?** MongoDB is a reasonable choice for document-shaped or evolving data, and it can support transactions and indexes. Here it adds a separate database service or hosted dependency without a clear benefit for these mostly relational records. Familiarity with MongoDB or an existing organizational deployment could change that decision. Switching later has moderate effort because queries and migrations need rewriting; keep persistence behind repositories without building a generic database framework.

## Fastify rather than another HTTP framework

**Decision:** Use Fastify for a compact TypeScript API, built-in request injection for tests, and a clear route/plugin structure. It supports schema-based validation and serialization ([Fastify documentation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)); shared application validation is planned separately to avoid duplicating form and API rules.

**Trade-off:** Fastify introduces framework-specific plugin and configuration patterns. Express is also viable and may be easier for a team already familiar with it; Node's built-in HTTP server avoids a framework but would require more plumbing. Performance is not the reason for this decision: maintainability and testability matter more for this workload. Replacing the HTTP layer later is possible but requires route and integration-test changes.

## React rather than a simpler interface

**Decision:** Use React with Vite for the login, connection, project selection, form, recent list, and key management screens. Components and shared state make these interactive flows straightforward, while the compiled files can be served by the API container.

**Trade-off:** React and its build tooling increase dependencies and generated bundle size for a small UI. Server-rendered HTML or plain browser JavaScript would be simpler for a handful of static forms, but would require a different approach to managing the changing interface. Keep the UI small; do not add a component library or client-side state framework without a demonstrated need. This choice is reversible at moderate cost because the browser uses the application's HTTP API.

## Jira SDK or a small direct client

**Decision:** Evaluate the community-maintained [jira.js](https://github.com/MrRefactoring/jira.js) SDK during the Jira phase before choosing it or a small direct HTTP client. The SDK documents TypeScript support, Jira Cloud APIs, OAuth 2.0 authorization helpers, token refresh, and a refresh-persistence callback ([OAuth guide](https://mrrefactoring.github.io/jira.js/guide/oauth2-authentication)). It is not presented here as an official Atlassian SDK. Atlassian documents the underlying [Jira Cloud REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) and recommends [OAuth 2.0 for most integrations](https://developer.atlassian.com/cloud/jira/platform/security-for-other-integrations/).

**Potential benefit:** Typed operations and maintained API models could reduce handwritten request code. **Cost and risk:** an additional dependency and behavior that must be understood, including retries and refresh handling. Automatic retry of issue creation must not cause duplicates after an uncertain result.

Before adopting it, verify against the installed version and fake-server tests: configurable auth and API bases; authorization URL and callback behavior; project and issue-type operations; timeouts, redirects and safe errors; token rotation persisted before reuse; and concurrent refresh behavior across all requests for a user. Check how retries interact with create operations, and retain our own bounded per-site queue, authorization, isolation, and idempotency rules. If the SDK cannot meet these requirements cleanly, use a small direct client instead. Neither option is verified against live Jira yet. Keep the choice isolated behind the Jira boundary so it can be changed.

## OAuth and local ticket history

OAuth avoids asking users for personal Jira API tokens, but adds app registration, callback handling, state validation, encrypted token storage, and rotating refresh-token complexity. A simpler token-based integration would reduce setup but is less suitable for a multi-user connection flow. The recent list uses our own user-scoped ticket records because labels do not establish user ownership; the trade-off is that external Jira changes are not synchronized.

## AI digest and uncertain outcomes

A model can produce a more useful summary than an extractive fallback, but adds provider access, cost, latency, and untrusted-input risks. The provider is still undecided. Restrict the model to summarization, validate output, and clearly label fallback results as degraded.

A database transaction cannot include the remote Jira request. Persisting pending, done, and unknown states reduces duplicate creates, but an uncertain outcome requires human investigation and can interrupt retries. This favors avoiding duplicate tickets over automatic recovery; reconciliation and durable queues are future work.

## Registration feedback and account discovery

**Decision:** Tell a user when an email address is already registered so they can sign in instead. Login failures remain generic, and registration and login are rate-limited.

**Trade-off:** The registration response reveals whether an email is registered, making account enumeration possible. Rate limiting reduces but does not eliminate that risk. A production system should consider a generic response with verified email-based account recovery and stronger distributed abuse controls.

## Browser test isolation

**Decision:** Run end-to-end tests against a separate local server and a temporary SQLite database, then remove the temporary directory after the run. This exercises the real UI, API, migrations, and database without modifying a developer's accounts.

**Trade-off:** Browser installation and a full application build make these tests slower than Fastify injection tests. A forced termination or machine crash can leave a temporary folder behind; ordinary test failures are cleaned up. No external services are contacted.

## Radix account menu

Use the focused Radix Dropdown Menu primitive for keyboard and focus handling, with project CSS for appearance. This adds a web dependency but avoids implementing menu accessibility from scratch. No full component framework or router is introduced.

## Temporary finding draft

The draft is kept in memory so it is not retained in browser storage. It is lost on reload or process termination; the browser may suppress unload warnings. Radix Alert Dialog supplies accessible confirmation and focus handling before in-app navigation.

## Settings tabs

Radix Tabs supplies keyboard navigation for the Jira and scanner settings panels. The panels describe unavailable services and do not simulate connections or keys.
