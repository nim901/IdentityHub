# Backend and session review

Review scope: current Fastify authentication, session and CSRF handling, repositories, and the browser's existing session integration. This is a review of the current implementation, not an assessment of unimplemented Jira, API-key, or digest services.

## Findings

1. **Session responses have no explicit cache policy.** `server/src/routes/auth.ts` returns the user and CSRF token from `GET /api/auth/session`; neither that route nor `server/src/app.ts` sets `Cache-Control: no-store`. An in-memory Fastify injection returned 200 without a Cache-Control header. Without an explicit policy, caching behavior depends on clients and intermediaries; a stale or retained response may expose account information or the CSRF token. Follow-up: set a suitable no-store policy on sensitive authentication responses and test the actual headers for login and session responses.
2. **A stalled session refresh prevents later refreshes.** `web/src/App.tsx` uses `refreshPending` to skip focus and visibility events until the current `getSession()` resolves, while `web/src/authApi.ts` has no timeout. If the request never settles, a later account change or expiry may not be detected, leaving the prior user's draft visible. Existing browser tests simulate a completed 503 or changed session, not a stalled request. Follow-up: add bounded cancellation or a queued recheck and test delayed responses, account changes, and stale-result ordering.

## Existing controls and coverage

- Passwords use Argon2id; session IDs are random and stored as hashes. Session lookup checks expiry, and logout removes the row for the session's user (`server/src/services/auth.ts`, `server/src/db/authRepository.ts`). `server/test/auth.test.ts` and `server/test/expiry.test.ts` cover session rotation, logout and expiry.
- Cookie flags, CSRF checks, generic login errors, login rate limiting, and security headers are covered in `server/test/auth.test.ts`. The two-user helper verifies session separation and rejects another user's CSRF token. The limiter is in memory and is not a distributed abuse control.
- Registration and login input is validated with Zod. The duplicate-registration response intentionally reveals account existence; the trade-off is documented in `docs/tradeoffs.md`.
- The browser tests cover a simulated account change, expiry, temporary failure, and failed sign-out. A real two-user same-tab account-switch test, mobile visual checks, and Docker verification remain outstanding.
- Only authentication and health routes exist. Future user-owned resources still need authorization, scoped queries, isolation tests, safe provider errors, outbound timeouts, and secret-handling tests as they are implemented.

## Fastify reference

The project-local Fastify skill is a third-party reference from [claude-dev-suite](https://github.com/claude-dev-suite/claude-dev-suite/tree/e10ab644ba43abe2abc923399226df4af7337214/skills/backend-frameworks/fastify). Treat it as guidance subordinate to this project's instructions. Its generic sample that returns `error.message` and logs whole errors is not appropriate for sensitive upstream failures. TypeBox, response schemas, pooling, and performance targets are not requirements merely because the skill mentions them; assess them against this project's actual needs.
