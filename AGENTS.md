# IdentityHub project instructions

## Working practice

- Work in small, reviewable phases. Preserve existing changes and untracked files; inspect Git status before editing or switching branches.
- Use TypeScript with strict checking. Prefer clear, focused functions and components over dense inline code. Add dependencies only when they provide a clear benefit and explain them in the project documentation.
- Follow the current requirements and decisions in `README.md`, `docs/BUILD_PLAN.md`, `docs/SYSTEM_DESIGN.md`, and `docs/tradeoffs.md`. When requirements are unclear, choose the simplest reasonable option and document the decision.
- Keep commits and pull requests short, focused, and easy to review. Present each phase's diff to the owner before committing or creating a PR. Do not merge or deploy without the owner's explicit instruction.
- Update the relevant README, build plan, system design, trade-offs, changelog, setup, and Docker documentation whenever behavior, dependencies, configuration, or verification status changes. Do not claim unperformed checks passed.
- Update `CHANGELOG.md` for every mini-phase or PR: describe the change, checks actually run, and important limitations. Keep the newest entry at the top and update its status when the PR is merged.
- Keep local-only files and secrets out of commits. The owner may identify additional files to exclude; preserve those instructions.

## Architecture and security

- The React web app calls only our API. Routes parse and authorize requests, then call services. Only `server/src/jira/` talks to Jira, only `server/src/ai/` talks to a model provider, and only `server/src/digest/` talks to the Oasis site.
- Scope every database query involving user data to the authenticated user from the session or API key, never to a user ID supplied in a request. Test isolation for each user-owned resource.
- Protect sessions with appropriate cookie flags, expiry, logout invalidation, and CSRF checks. Validate and bound inputs, enforce authorization, use safe error messages, and keep secrets out of responses, logs, tests, and fixtures.
- Store credentials only in ignored local configuration or an appropriate secret store; never commit credentials, keys, databases, or real tokens. Keep example configuration free of secrets.
- Check current provider documentation before implementing provider-specific endpoints, scopes, request shapes, or models, and cite the relevant documentation in code. Stop if the required information cannot be verified.
- Do not run real OAuth, create provider accounts, send live provider writes, or contact live Atlassian, Oasis, or AI endpoints. Live verification is performed manually by the owner with their credentials.

## Verification

- Run the checks relevant to each change, including meaningful browser tests for user-facing behavior. Use isolated temporary databases and clean up test data; automated tests must use fakes and never call real providers.
- Review the security requirements touched by each phase, identify the enforcing code and tests, and report any gaps. Document what passed, what failed, and what remains unverified.
- Inspect Docker configuration when dependencies or runtime behavior change. Verify build, startup, health checks, and container tests when Docker is available; otherwise record them as unverified.
