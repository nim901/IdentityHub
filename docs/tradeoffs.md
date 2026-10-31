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

**Decision:** Use the community-maintained [jira.js](https://github.com/MrRefactoring/jira.js) SDK for the future Jira integration. Its typed operations, OAuth helpers, refresh and persistence callback ([OAuth guide](https://mrrefactoring.github.io/jira.js/guide/oauth2-authentication)) justify the dependency for this project. Application-level user isolation and durable rotation remain our responsibility. Its [error guide](https://mrrefactoring.github.io/jira.js/guide/error-handling) describes optional transport retries and a separate OAuth 401 retry, which require particular care for issue creation.

**Installed-version evaluation:** Inspected `jira.js` 6.3.0; its sole runtime dependency is `zod`. Its OAuth helpers hard-code the Atlassian authorization, token, and resource URLs and the OAuth client hard-codes the Jira gateway. Tests dispatch the generated authorization path to the local fake and inject a fetch adapter that allows only the expected OAuth URLs and never makes network requests. Production URL rewriting is not added. An earlier fake-only helper exercise also checked refresh responses; no provider was contacted.

The SDK awaits `onTokenRefresh`, but updates its in-memory tokens before that callback succeeds; callers must handle persistence failure and recovery. Its single-flight lock belongs to one client instance, not all clients or processes for a user; an intercepted test confirmed one refresh for simultaneous requests on one manager and separate refreshes from two managers. The callback parser checks state but does not provide session binding, expiry or single-use storage. API requests accept an abort signal, while OAuth helpers provide a custom fetch seam rather than a built-in timeout; requests do not set a redirect policy, so a wrapper must enforce timeouts and reject redirects. Error messages can include provider response bodies and need sanitization before logging or returning to users. Transport retries default off, but OAuth can refresh and retry on 401, including writes. Project and issue operations are available, but their actual permissions and response behavior remain unverified against Jira.

The SDK reduces handwritten API and OAuth code but adds a dependency and behavior to understand. Keep it behind the Jira boundary. Live Jira compatibility remains unverified.

The SDK's strict create-field schema requires a `schema` field that Atlassian's documented response example omits. The client suppresses SDK schema-mismatch reporting and validates the project, issue-type, field, and created-issue data it uses itself; this avoids logging provider data and rejecting that documented shape. The selected site's current accessible-resource scopes determine whether the grant permits writes, since a token response may omit `scope`.

**Potential benefit:** Typed operations and maintained API models could reduce handwritten request code. **Cost and risk:** an additional dependency and behavior that must be understood, including retries and refresh handling. Automatic retry of issue creation must not cause duplicates after an uncertain result.

Regardless of client, verify fake-server behavior, safe errors, token rotation persisted before reuse, and concurrent refresh across requests for a user. Retain the bounded per-site queue, authorization, isolation, and idempotency rules behind the Jira boundary.

## OAuth and local ticket history

OAuth avoids asking users for personal Jira API tokens, but adds app registration, callback handling, state validation, encrypted token storage, and rotating refresh-token complexity. A simpler token-based integration would reduce setup but is less suitable for a multi-user connection flow. The recent list uses our own user-scoped ticket records because labels do not establish user ownership; the trade-off is that external Jira changes are not synchronized.

The callback consumes state before code exchange, so an upstream or storage failure requires a new authorization. Only one outstanding request per session is kept, so a later start invalidates the earlier one. A new flow removes that user's expired states, and session deletion cascades to pending states. Tokens are encrypted with AES-256-GCM using a stable externally configured key and user/type-bound authenticated data. Losing or changing that key makes stored tokens unreadable; key rotation remains future work; refresh rotation is coordinated per user in one process and a failed or interrupted rotation requires reconnection. Overlapping exchanges for one user are rejected within this single-instance app; this is not a cross-process lock.

## AI digest and uncertain outcomes

A model can produce a more useful summary than an extractive fallback, but adds provider access, cost, latency, and untrusted-input risks. The preview uses the OpenAI API with an operator-supplied model and key; direct ChatGPT plan authorization is not yet implemented. Restrict the model to summarization, validate output, and clearly label fallback results as degraded.

A database transaction cannot include the remote Jira request. Persisting pending, done, and unknown states reduces duplicate creates, but an uncertain outcome requires human investigation and can interrupt retries. This favors avoiding duplicate tickets over automatic recovery; reconciliation and durable queues are future work.

## Registration feedback and account discovery

**Decision:** Tell a user when an email address is already registered so they can sign in instead. Login failures remain generic, and registration and login are rate-limited.

**Trade-off:** The registration response reveals whether an email is registered, making account enumeration possible. Rate limiting reduces but does not eliminate that risk. A production system should consider a generic response with verified email-based account recovery and stronger distributed abuse controls.

## Browser test isolation

**Decision:** Run end-to-end tests against a separate local server and a temporary SQLite database, then remove the temporary directory after the run. This exercises the real UI, API, migrations, and database without modifying a developer's accounts.

**Trade-off:** Browser installation and a full application build make these tests slower than Fastify injection tests. A forced termination or machine crash can leave a temporary folder behind; ordinary test failures are cleaned up. No external services are contacted.

Server test files run with one Vitest worker and a 15-second default timeout. This reduces contention between real Argon2 operations and gives slower machines room to finish, at the cost of a longer suite. Production password-hashing parameters remain unchanged.

## Radix account menu

Use the focused Radix Dropdown Menu primitive for keyboard and focus handling, with project CSS for appearance. This adds a web dependency but avoids implementing menu accessibility from scratch. No full component framework or router is introduced.

## Temporary finding draft

The draft is kept in memory so it is not retained in browser storage. It is lost on reload or process termination; the browser may suppress unload warnings. Radix Alert Dialog supplies accessible confirmation and focus handling before in-app navigation.

## Settings tabs

Radix Tabs supplies keyboard navigation for the Jira and scanner settings panels. The panels report connection state and use the application API for real key management.

## Jira site discovery

The user selects one accessible Jira Cloud site; each project query checks current resource access. Site URLs are restricted to HTTPS `*.atlassian.net` hosts. Custom domains and multiple server processes are not supported. Live provider behavior remains unverified.

## Jira create metadata and duplicate prevention

We inspect Jira's project and issue-type create metadata before writing and select a supported non-subtask type, preferring the optional configured name and then Task. This deliberately rejects configurations with unsupported required fields rather than guessing. A bounded in-memory per-site queue and a user-scoped idempotency reservation reduce duplicate creation; they do not provide distributed coordination or exactly-once delivery. Unknown outcomes require manual investigation, and the caller must not use a new key without checking Jira. The local recent list is user-isolated but does not reflect external edits. Sites with custom domains are not supported. Live behavior and permissions still need owner verification.

## Connection UI and callback

Connection status reports saved credentials, not a live guarantee of Jira access; site and project discovery can still fail and prompt reconnection. OAuth callbacks return to fixed paths on the API origin, so local OAuth uses the built app on that origin. Project choice is held in memory and resets on site or account changes. Browser tests inject a fake transport into a dedicated server process, with no production fake switch.

Browser failure scenarios start isolated servers with missing or invalid Jira configuration or a fake token-exchange error. The harness clears inherited Jira settings so the missing-configuration case cannot accidentally use local credentials. The exchange fake writes only an operation marker to the test's temporary directory to prove that the token request occurred; the directory is removed after the run. These tests exercise our application and a fake provider; they do not establish live Atlassian compatibility.

The browser includes its session-bound CSRF token with Jira reads. The server validates that token when supplied, so a cookie change during an in-flight read cannot return another account's Jira data to the old view. Callers without the header retain the existing read contract. A successful focus or visibility session check refreshes connection status so another tab's site selection becomes visible.

## Finding UI outcomes

The browser submits once per attempt with a new idempotency key. It preserves the draft for rejected or unknown results and requires an explicit acknowledgment after an unknown outcome. This does not provide exactly-once delivery: a reload loses the in-memory warning and the owner must check Jira before retrying. The local recent list can omit a Jira issue if local recording failed. History requests bind the provided CSRF token to the active session, wait for connection status after a focus refresh, and restrict links to the selected Atlassian site. Unrecognized write responses remain uncertain even when their HTTP status usually indicates rejection.

The UI includes the expected site ID on finding writes and history reads to detect changes made in another tab. For compatibility with the existing session API, the field is optional for other callers; those callers accept the currently selected site instead. The server still scopes every operation to the authenticated user and verifies the selected site before a write.

## API key management

Keys use 32 random bytes and are stored as SHA-256 hashes with a short display prefix. A key belongs to one user and Jira site and records one to twenty project keys and their discovered project IDs. Jira project keys can change ([Atlassian CLI documentation](https://developer.atlassian.com/cloud/acli/reference/commands/jira-project-update/)); the scanner resolves and enforces stored project IDs, and rejects legacy records missing IDs. The compatibility migration preserves earlier records without guessing IDs; the UI labels them for replacement and permits revocation. Creation rechecks the session and site after discovery; existing keys can be listed and revoked without a live Jira connection. The UI shows the secret once in memory and treats failed or lost creation responses as uncertain, directing the user to reconcile the list. In-app navigation is disabled during key creation and an unload warning is requested; browsers may suppress that warning. At most 20 keys can be active and the list returns up to 100 entries, with active keys first. The scanner API enforces these restrictions against freshly discovered Jira project IDs.


## Scanner API

The scanner accepts an optional idempotency key to support clients that cannot provide one, but requests without one cannot be safely retried. The supplied key is scoped to the API key, so different keys do not share replay records. The fingerprint retains the separately validated fields rather than only the formatted description, so different inputs cannot be mistaken for the same request. Scanner operations from the previous uncommitted implementation fail closed with a conflict if replayed after this fingerprint change. Metadata fields are bounded plain text appended to the Jira description. A single-process IP rate limit limits abuse; it is not a distributed quota. Queued or in-flight requests check revocation before the Jira write, but an already dispatched provider request cannot be recalled.


## Blog discovery

Oasis advertises its sitemap in robots.txt. Read-only inspection found that article JSON-LD `datePublished` can reflect a later update while the visible “Published on” field gives an earlier publication date. Discovery therefore parses the visible heading and publication date, fails closed when that markup is missing or ambiguous, and reports the number of posts sharing the latest day. A deterministic URL tie-break does not establish publication order within that day. The listing order and `resources-new_list w-dyn-items` class are not assumed to be complete or chronologically sorted.

The command conservatively stops for any nonempty robots.txt disallow or nonzero crawl delay in any group, a missing wildcard user-agent, an unadvertised expected sitemap, or an unsupported directive. This can stop for a restriction intended for another crawler. An explicit transport allows tests without network traffic. `saxes` parses XML without external entities and `parse5` parses HTML; DTDs are rejected. Unsupported markup, size or count limits, failed requests, and an unresponsive transport stop discovery rather than claim a partially scanned result is newest. A timeout disables further discovery in that process until restart. The one-hour metadata-only in-memory cache uses sitemap `lastmod` as an invalidation hint, never as a publication date; unchanged or inaccurate lastmod can leave a result stale during that window. Cache records are checked for matching safe URLs and valid title and date fields, but only trusted application code should populate the cache. It is not persistent or shared across processes. Encoded same-origin paths and unapproved variants of the Oasis host fail discovery instead of being silently skipped.


The summary preview accepts only one observed Oasis rich-text container and fails closed when it is missing or ambiguous. This favors avoiding accidental navigation or unrelated content but may reject other article layouts; only one live article was inspected. The model receives untrusted article text without tools, but validated plain text can still contain inaccurate or adversarial content and needs human review.

The preview re-fetches the selected article and refuses to summarize if its visible title or publication date changed after discovery. A body-only change with unchanged metadata remains undetectable. Configuration is validated before discovery to avoid unnecessary requests.
