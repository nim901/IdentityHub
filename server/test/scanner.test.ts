import { expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createTwoUsers } from "./helpers/users.js";
import { Writable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID } from "node:crypto";

function disableEnvironmentOAuth() {
  for (const name of ["ATLASSIAN_CLIENT_ID", "ATLASSIAN_CLIENT_SECRET", "OAUTH_REDIRECT_URI", "ENCRYPTION_KEY"]) vi.stubEnv(name, "");
}

it("requires an API key for scanner requests even when a session is absent", async () => {
  disableEnvironmentOAuth();
  const app = await buildApp({ databasePath: ":memory:" });
  try {
    const response = await app.inject({ method: "POST", url: "/api/v1/findings", payload: { project: "ONE", title: "Example", description: "Example" } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Invalid API key" });
  } finally { await app.close(); vi.unstubAllEnvs(); }
});

it("enforces key ownership and project IDs and preserves idempotent and unknown outcomes", async () => {
  let writes = 0;
  let projectId = "100";
  let missing = false;
  let blockMetadata = false;
  let metadataStarted!: () => void;
  let releaseMetadata!: () => void;
  const started = new Promise<void>(resolve => { metadataStarted = resolve; });
  const released = new Promise<void>(resolve => { releaseMetadata = resolve; });
  const logs: string[] = [];
  const directory = mkdtempSync(join(tmpdir(), "identityhub-scanner-"));
  const databasePath = join(directory, "test.db");
  const loggerStream = new Writable({ write(chunk, _encoding, callback) { logs.push(String(chunk)); callback(); } });
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.href === "https://auth.atlassian.com/oauth/token") return Response.json({ access_token: "fake-access", refresh_token: "fake-refresh", expires_in: 3600 });
    if (url.href === "https://api.atlassian.com/oauth/token/accessible-resources") return Response.json([{ id: "site-one", name: "One", url: "https://one.atlassian.net", scopes: ["read:jira-work", "write:jira-work"] }]);
    if (url.origin !== "https://api.atlassian.com") throw new Error("Unexpected provider");
    const path = url.pathname.replace("/ex/jira/site-one", "");
    if (path === "/rest/api/3/project/search") return Response.json({ startAt: 0, isLast: true, values: missing ? [] : [{ id: projectId, key: "ONE", name: "One" }, { id: "101", key: "TWO", name: "Two" }] });
    if (path === "/rest/api/3/issue/createmeta/ONE/issuetypes") {
      if (blockMetadata) { metadataStarted(); await released; }
      return Response.json({ startAt: 0, total: 1, issueTypes: [{ id: "1", name: "Task", subtask: false }] });
    }
    if (path === "/rest/api/3/issue/createmeta/ONE/issuetypes/1") return Response.json({ startAt: 0, total: 2, fields: [{ fieldId: "summary", operations: ["set"], required: true }, { fieldId: "description", operations: ["set"], required: false }] });
    if (path === "/rest/api/3/issue" && init?.method === "POST") {
      writes++;
      const body = JSON.parse(String(init.body));
      expect(body.fields.project).toEqual({ id: "100" });
      expect(JSON.stringify(body.fields.description)).toContain("Severity: high");
      if (body.fields.summary === "Unknown") return new Response("private fake failure", { status: 503 });
      return Response.json({ id: String(1000 + writes), key: `ONE-${writes}` }, { status: 201 });
    }
    throw new Error("Unexpected fake request");
  };
  const app = await buildApp({ databasePath, loggerStream, jiraOAuth: { clientId: "fake", clientSecret: "fake", redirectUri: "http://localhost:3000/api/jira/callback", encryptionKey: Buffer.alloc(32, 7).toString("base64"), fetch: fake } });
  try {
    const { a, b } = await createTwoUsers(app);
    const start = await app.inject({ method: "POST", url: "/api/jira/connect", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken } });
    const state = new URL(start.json().authorizationUrl).searchParams.get("state");
    await app.inject({ url: `/api/jira/callback?code=fake&state=${state}`, headers: { cookie: a.cookie } });
    await app.inject({ method: "POST", url: "/api/jira/site", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken }, payload: { id: "site-one" } });
    const createdKey = await app.inject({ method: "POST", url: "/api/keys", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken }, payload: { name: "Scanner", siteId: "site-one", projects: ["ONE"] } });
    expect(createdKey.statusCode).toBe(201);
    const { key, apiKey } = createdKey.json();
    const body = { project: "ONE", title: "Finding", description: "Text", severity: "high" };
    const call = (id: string, payload: { project: string; title: string; description: string; severity?: string } = body, secret = key) => app.inject({ method: "POST", url: "/api/v1/findings", headers: { "x-api-key": secret, "idempotency-key": id }, payload });
    const modify = (sql: string, ...args: unknown[]) => { const db = new Database(databasePath); try { db.prepare(sql).run(...args); } finally { db.close(); } };
    expect((await call("scanner-key-000001", body, "invalid")).statusCode).toBe(401);
    modify("UPDATE api_keys SET allowed_project_ids_json = NULL WHERE id = ?", apiKey.id);
    expect((await call("scanner-key-000001")).statusCode).toBe(401);
    modify("UPDATE api_keys SET allowed_project_ids_json = ? WHERE id = ?", '["100"]', apiKey.id);
    modify("UPDATE jira_sites SET cloud_id = ? WHERE cloud_id = ?", "other-site", "site-one");
    expect((await call("scanner-key-000001")).statusCode).toBe(403);
    modify("UPDATE jira_sites SET cloud_id = ? WHERE cloud_id = ?", "site-one", "other-site");
    expect((await call("scanner-key-000001", { ...body, project: "TWO" })).statusCode).toBe(403);
    expect((await call("scanner-key-000001", { ...body, title: "" })).statusCode).toBe(422);
    expect((await call("short")).json().fields["Idempotency-Key"]).toBeTruthy();
    expect((await app.inject({ method: "POST", url: "/api/v1/findings", headers: { "x-api-key": key, "content-type": "application/json" }, payload: "{" })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/v1/findings", headers: { "x-api-key": key }, payload: { ...body, description: "x".repeat(70000) } })).statusCode).toBe(413);
    expect((await app.inject({ method: "POST", url: "/api/v1/findings", headers: { cookie: b.cookie, "x-api-key": key }, payload: { ...body, project: "TWO" } })).statusCode).toBe(403);
    projectId = "999";
    expect((await call("scanner-key-000001")).statusCode).toBe(403);
    projectId = "100"; missing = true;
    expect((await call("scanner-key-000001")).statusCode).toBe(404);
    missing = false;
    const results = await Promise.all([call("scanner-key-000001"), call("scanner-key-000001")]);
    expect(results.map(result => result.statusCode).sort()).toEqual([200, 201]);
    expect(results[0].headers.location).toMatch(/^https:\/\/one\.atlassian\.net\/browse\/ONE-/);
    expect(writes).toBe(1);
    expect((await call("scanner-key-000001", { ...body, title: "Different" })).statusCode).toBe(409);
    const flattened = { project: "ONE", title: "Finding", description: "Text\n\nSeverity: high" };
    expect((await call("scanner-key-000001", flattened)).statusCode).toBe(409);
    const unknown = await call("scanner-key-000002", { ...body, title: "Unknown" });
    expect(unknown.statusCode).toBe(502);
    expect(unknown.body).not.toContain("private fake failure");
    expect((await call("scanner-key-000002", { ...body, title: "Unknown" })).statusCode).toBe(409);
    expect(writes).toBe(2);
    expect((await app.inject({ url: "/api/findings?project=ONE", headers: { cookie: b.cookie } })).json().findings).toEqual([]);
    expect(logs.join("")).not.toContain(key);
    blockMetadata = true;
    const pending = call("scanner-key-000003");
    await started;
    expect((await app.inject({ method: "DELETE", url: `/api/keys/${apiKey.id}`, headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken } })).statusCode).toBe(204);
    releaseMetadata();
    expect((await pending).statusCode).toBe(401);
    expect((await call("scanner-key-000004")).statusCode).toBe(401);
    expect(writes).toBe(2);
  } finally { releaseMetadata(); await app.close(); rmSync(directory, { recursive: true, force: true }); }
}, 30000);

it("bounds unauthenticated scanner traffic and reports Retry-After", async () => {
  disableEnvironmentOAuth();
  const app = await buildApp({ databasePath: ":memory:" });
  try {
    let response = await app.inject({ method: "POST", url: "/api/v1/findings", payload: {} });
    for (let i = 1; i <= 30; i++) response = await app.inject({ method: "POST", url: "/api/v1/findings", payload: {} });
    expect(response.statusCode).toBe(429);
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
  } finally { await app.close(); vi.unstubAllEnvs(); }
});

it("reports an unavailable integration without exposing configuration", async () => {
  disableEnvironmentOAuth();
  const directory = mkdtempSync(join(tmpdir(), "identityhub-scanner-offline-"));
  const path = join(directory, "test.db");
  const app = await buildApp({ databasePath: path });
  try {
    const { a } = await createTwoUsers(app);
    const key = `ih_${randomBytes(32).toString("base64url")}`;
    const db = new Database(path);
    try {
      const owner = db.prepare("SELECT id FROM users WHERE email = ?").get(a.credentials.email) as { id: string };
      db.prepare("INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, site_id, allowed_projects_json, allowed_project_ids_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), owner.id, "Offline", key.slice(0, 11), createHash("sha256").update(key).digest("hex"), "site-one", '["ONE"]', '["100"]', new Date().toISOString());
    } finally { db.close(); }
    const response = await app.inject({ method: "POST", url: "/api/v1/findings", headers: { "x-api-key": key }, payload: { project: "ONE", title: "Finding", description: "Text" } });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain(key);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
});
