import { buildApp } from "../server/src/app.js";
import { appendFileSync } from "node:fs";

const scenario = process.env.E2E_JIRA_SCENARIO ?? "success";
if (!["success", "missing", "invalid", "exchange"].includes(scenario)) {
  throw new Error("Unknown E2E Jira scenario");
}
// This entrypoint exists only for browser tests. It refuses all outbound requests.
const fakeFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.href === "https://auth.atlassian.com/oauth/token") {
    if (scenario === "exchange") {
      if (!process.env.E2E_FAKE_REQUEST_LOG)
        throw new Error("Missing fake request log");
      appendFileSync(process.env.E2E_FAKE_REQUEST_LOG, "token_exchange\n");
      return new Response("fake-private-provider-error", { status: 400 });
    }
    return Response.json({
      access_token: "fake-access",
      refresh_token: "fake-refresh",
      expires_in: 3600,
      scope: "read:jira-work write:jira-work offline_access",
    });
  }
  if (url.href === "https://api.atlassian.com/oauth/token/accessible-resources")
    return Response.json([
      {
        id: "site-one",
        name: "Example workspace",
        url: "https://example.atlassian.net",
        scopes: ["read:jira-work", "write:jira-work"],
      },
    ]);
  if (
    url.origin + url.pathname ===
    "https://api.atlassian.com/ex/jira/site-one/rest/api/3/project/search"
  )
    return Response.json({
      startAt: 0,
      maxResults: 50,
      total: 1,
      isLast: true,
      values: [{ id: "100", key: "ONE", name: "Identity operations" }],
    });
  throw new Error("Unexpected provider request in browser test");
};
const baseUrl = process.env.APP_BASE_URL!;
const app = await buildApp({
  databasePath: process.env.DATABASE_PATH,
  jiraOAuth:
    scenario === "missing"
      ? undefined
      : {
          clientId: "mock-client-id",
          clientSecret: "mock-client-secret",
          redirectUri: `${baseUrl}/api/jira/callback`,
          encryptionKey:
            scenario === "invalid"
              ? "invalid-fake-key"
              : Buffer.alloc(32, 7).toString("base64"),
          fetch: fakeFetch,
        },
});
await app.listen({ port: Number(process.env.PORT), host: "127.0.0.1" });
