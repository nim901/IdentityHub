# Backend and session review

Review scope: Fastify authentication, session and CSRF handling, repositories, and browser session integration at the time of the review. Jira backend and connection UI were added afterward; API-key and digest services remain unimplemented.

## Findings

1. **Session responses had no explicit cache policy (fixed in PR #7).** Authentication routes now send `Cache-Control: no-store`, including error responses. `server/test/auth.test.ts` checks successful login and session responses, unauthenticated session responses, and rate-limited login responses.
2. **A stalled session refresh blocked later refreshes (fixed in PR #7).** Session requests now time out after ten seconds. A newer visible focus or visibility check cancels and supersedes the previous one, and older responses are ignored. `e2e/settings.spec.ts` covers a stalled request, timeout, a later confirmed expiry, and draft preservation; simulated identity-change and temporary-failure tests continue to pass.

## Existing controls and coverage

- Passwords use Argon2id; session IDs are random and stored as hashes. Session lookup checks expiry, and logout removes the row for the session's user (`server/src/services/auth.ts`, `server/src/db/authRepository.ts`). `server/test/auth.test.ts` and `server/test/expiry.test.ts` cover session rotation, logout and expiry.
- Cookie flags, CSRF checks, generic login errors, login rate limiting, and security headers are covered in `server/test/auth.test.ts`. The two-user helper verifies session separation and rejects another user's CSRF token. The limiter is in memory and is not a distributed abuse control.
- Registration and login input is validated with Zod. The duplicate-registration response intentionally reveals account existence; the trade-off is documented in `docs/tradeoffs.md`.
- The browser tests cover expiry, temporary failure, failed sign-out, and a real local two-user account switch across tabs. The latter checks that an open draft and project key are cleared on session refresh. Provider integration and resource isolation remain future work.
- At the time of this review only authentication and health routes existed. Jira and findings routes were added later and require their own continuing security and isolation review.

## Fastify reference

The project-local Fastify skill is a third-party reference from [claude-dev-suite](https://github.com/claude-dev-suite/claude-dev-suite/tree/e10ab644ba43abe2abc923399226df4af7337214/skills/backend-frameworks/fastify). Treat it as guidance subordinate to this project's instructions. Its generic sample that returns `error.message` and logs whole errors is not appropriate for sensitive upstream failures. TypeBox, response schemas, pooling, and performance targets are not requirements merely because the skill mentions them; assess them against this project's actual needs.
