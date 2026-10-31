import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { buildApp } from "../src/app.js";
import { ApiKeyService } from "../src/services/apiKeys.js";
import { createTwoUsers } from "./helpers/users.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

it("creates user-scoped project-restricted keys, stores hashes, and revokes safely", async () => {
  const dir = mkdtempSync(join(tmpdir(), "identityhub-key-test-"));
  const path = join(dir, "test.db");
  let blockProjects = false;
  let ambiguousProjects = false;
  let malformedProjects = false;
  let releaseProjects!: () => void;
  let projectsStarted!: () => void;
  const blockedProjects = new Promise<void>(resolve => { releaseProjects = resolve; });
  const projectRequestStarted = new Promise<void>(resolve => { projectsStarted = resolve; });
  const fakeFetch: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.href === "https://auth.atlassian.com/oauth/token") return Response.json({ access_token: "fake-access", refresh_token: "fake-refresh", expires_in: 3600 });
    if (url.href === "https://api.atlassian.com/oauth/token/accessible-resources") return Response.json([{ id: "site-one", name: "Example", url: "https://example.atlassian.net", scopes: ["read:jira-work", "write:jira-work"] }]);
    if (url.pathname === "/ex/jira/site-one/rest/api/3/project/search") {
      if (blockProjects) { projectsStarted(); await blockedProjects; }
      return Response.json({ startAt: 0, isLast: true, values: [{ id: "100", key: "ONE", name: "One" }, { id: "101", key: "TWO", name: "Two" }, ...(ambiguousProjects ? [{ id: "102", key: "ONE", name: "Duplicate" }] : []), ...(malformedProjects ? [{ id: "", key: "BAD", name: "Invalid" }] : [])] });
    }
    throw new Error("Unexpected fake provider request");
  };
  const logs: string[] = [];
  const loggerStream = new Writable({ write(chunk, _encoding, callback) { logs.push(String(chunk)); callback(); } });
  const app = await buildApp({ loggerStream, databasePath: path, jiraOAuth: { clientId: "fake", clientSecret: "fake", redirectUri: "http://localhost:3000/api/jira/callback", encryptionKey: Buffer.alloc(32, 7).toString("base64"), fetch: fakeFetch } });
  cleanups.push(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const { a, b } = await createTwoUsers(app);
  const start = await app.inject({ method: "POST", url: "/api/jira/connect", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken } });
  const state = new URL(start.json().authorizationUrl).searchParams.get("state");
  await app.inject({ url: `/api/jira/callback?code=fake-code&state=${state}`, headers: { cookie: a.cookie } });
  await app.inject({ method: "POST", url: "/api/jira/site", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken }, payload: { id: "site-one" } });
  const payload = { name: "CI scanner", siteId: "site-one", projects: ["ONE", "TWO"] };
  expect((await app.inject({ method: "GET", url: "/api/keys" })).statusCode).toBe(401);
  expect((await app.inject({ method: "POST", url: "/api/keys", headers: { cookie: a.cookie }, payload })).statusCode).toBe(403);
  expect((await app.inject({ method: "POST", url: "/api/keys", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken }, payload: { ...payload, projects: ["OTHER"] } })).statusCode).toBe(403);
  expect((await app.inject({ method: "POST", url: "/api/keys", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken }, payload: { ...payload, projects: ["ONE", "ONE"] } })).statusCode).toBe(422);
  expect((await app.inject({ method: "POST", url: "/api/keys", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken }, payload: { ...payload, siteId: "other-site" } })).statusCode).toBe(409);
  ambiguousProjects = true;
  expect((await app.inject({ method: "POST", url: "/api/keys", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken }, payload })).statusCode).toBe(502);
  ambiguousProjects = false;
  malformedProjects = true;
  expect((await app.inject({ method: "POST", url: "/api/keys", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken }, payload })).statusCode).toBe(502);
  malformedProjects = false;
  const created = await app.inject({ method: "POST", url: "/api/keys", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken }, payload });
  expect(created.statusCode).toBe(201);
  expect(created.headers["cache-control"]).toContain("no-store");
  const { key, apiKey } = created.json();
  expect(key).toMatch(/^ih_[A-Za-z0-9_-]{43}$/);
  expect(apiKey).toMatchObject({ name: "CI scanner", siteId: "site-one", projects: ["ONE", "TWO"], revokedAt: null, requiresReplacement: false });
  const db = new Database(path, { readonly: true });
  let row: { key_hash: string; allowed_project_ids_json: string };
  let serialized: string;
  try {
    row = db.prepare("SELECT key_hash, allowed_project_ids_json FROM api_keys WHERE id = ?").get(apiKey.id) as { key_hash: string; allowed_project_ids_json: string };
    serialized = JSON.stringify(db.prepare("SELECT * FROM api_keys").all());
  } finally { db.close(); }
  expect(row.key_hash).toBe(createHash("sha256").update(key).digest("hex"));
  expect(JSON.parse(row.allowed_project_ids_json)).toEqual(["100", "101"]);
  expect(serialized).not.toContain(key);
  const listed = await app.inject({ url: "/api/keys", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken } });
  expect(listed.json().keys).toHaveLength(1);
  expect(listed.body).not.toContain(key);
  expect((await app.inject({ url: "/api/keys", headers: { cookie: a.cookie, "x-csrf-token": b.csrfToken } })).statusCode).toBe(403);
  expect((await app.inject({ url: "/api/keys", headers: { cookie: b.cookie, "x-csrf-token": b.csrfToken } })).json().keys).toEqual([]);
  expect((await app.inject({ method: "DELETE", url: `/api/keys/${apiKey.id}`, headers: { cookie: b.cookie, "x-csrf-token": b.csrfToken } })).statusCode).toBe(404);
  expect((await app.inject({ method: "DELETE", url: `/api/keys/${apiKey.id}`, headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken } })).statusCode).toBe(204);
  expect((await app.inject({ url: "/api/keys", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken } })).json().keys[0].revokedAt).toBeTruthy();
  expect(logs.join("")).not.toContain(key);
  const seed = new Database(path);
  const owner = seed.prepare("SELECT id FROM users WHERE email = ?").get(a.credentials.email) as { id: string };
  const ids = Array.from({ length: 20 }, () => randomUUID());
  const insert = seed.prepare("INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, site_id, allowed_projects_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const id of ids) insert.run(id, owner.id, "Fake fixture", "ih_fixture", createHash("sha256").update(id).digest("hex"), "site-one", '["ONE"]', new Date().toISOString());
  seed.close();
  expect((await app.inject({ method: "POST", url: "/api/keys", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken }, payload })).statusCode).toBe(409);
  expect((await app.inject({ method: "DELETE", url: `/api/keys/${ids[0]}`, headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken } })).statusCode).toBe(204);
  expect((await app.inject({ method: "POST", url: "/api/keys", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken }, payload })).statusCode).toBe(201);
  blockProjects = true;
  const pending = app.inject({ method: "POST", url: "/api/keys", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken }, payload });
  await projectRequestStarted;
  expect((await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: a.cookie, "x-csrf-token": a.csrfToken } })).statusCode).toBe(204);
  releaseProjects();
  expect((await pending).statusCode).toBe(401);
  const verify = new Database(path, { readonly: true });
  expect((verify.prepare("SELECT COUNT(*) AS n FROM api_keys").get() as { n: number }).n).toBe(22);
  verify.close();
}, 30000);

it("fails closed without Jira configuration and bounds key input", async () => {
  const app = await buildApp({ databasePath: ":memory:" });
  cleanups.push(async () => { await app.close(); });
  const { a } = await createTwoUsers(app);
  const headers = { cookie: a.cookie, "x-csrf-token": a.csrfToken };
  const payload = { name: "Scanner", siteId: "site-one", projects: ["ONE"] };
  expect((await app.inject({ method: "POST", url: "/api/keys", headers, payload })).statusCode).toBe(503);
  expect((await app.inject({ method: "POST", url: "/api/keys", headers, payload: { ...payload, name: " " } })).statusCode).toBe(422);
  expect((await app.inject({ method: "POST", url: "/api/keys", headers, payload: { ...payload, projects: [] } })).statusCode).toBe(422);
  expect((await app.inject({ method: "POST", url: "/api/keys", headers, payload: { ...payload, projects: Array.from({ length: 21 }, (_, i) => `P${i}`) } })).statusCode).toBe(422);
  expect((await app.inject({ url: "/api/keys", headers })).json().keys).toEqual([]);
});


it("upgrades an existing database without removing users", async () => {
  const dir = mkdtempSync(join(tmpdir(), "identityhub-key-upgrade-"));
  const path = join(dir, "existing.db");
  const old = new Database(path);
  old.pragma("foreign_keys = ON");
  old.exec("CREATE TABLE migrations (name TEXT PRIMARY KEY)");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(name => /^00[1-6]_.*\.sql$/.test(name)).sort()) {
    old.exec(readFileSync(new URL(name, migrations), "utf8"));
    old.prepare("INSERT INTO migrations (name) VALUES (?)").run(name);
  }
  old.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run("existing-user", "existing@example.test", "fake-hash", "2026-01-01T00:00:00.000Z");
  const priorMigration = "007_api_keys.sql";
  old.exec(readFileSync(new URL(priorMigration, migrations), "utf8"));
  old.prepare("INSERT INTO migrations (name) VALUES (?)").run(priorMigration);
  old.prepare("INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, site_id, allowed_projects_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("legacy-key", "existing-user", "Legacy key", "ih_fake", "fake-hash", "site-one", '["ONE"]', "2026-01-01T00:00:00.000Z");
  old.close();
  const app = await buildApp({ databasePath: path });
  cleanups.push(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const updated = new Database(path, { readonly: true });
  try {
    expect(updated.prepare("SELECT id FROM users WHERE email = ?").get("existing@example.test")).toEqual({ id: "existing-user" });
    expect(updated.prepare("SELECT name FROM migrations WHERE name = ?").get("007_api_keys.sql")).toBeTruthy();
    expect(updated.prepare("SELECT allowed_project_ids_json FROM api_keys WHERE id = ?").get("legacy-key")).toEqual({ allowed_project_ids_json: null });
    expect(updated.prepare("SELECT name FROM migrations WHERE name = ?").get("008_api_key_project_ids.sql")).toBeTruthy();
    expect(new ApiKeyService(updated).list("existing-user")[0].requiresReplacement).toBe(true);
  } finally { updated.close(); }
});
