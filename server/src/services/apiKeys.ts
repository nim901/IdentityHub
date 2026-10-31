import { createHash, randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { SessionRecord } from "../db/authRepository.js";
import type { JiraConnection } from "../jira/connection.js";

export class ApiKeyError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

type KeyRow = { id: string; name: string; key_prefix: string; site_id: string; allowed_projects_json: string; allowed_project_ids_json: string | null; created_at: string; revoked_at: string | null };
function publicKey(row: KeyRow) {
  const projects = JSON.parse(row.allowed_projects_json) as string[];
  let validIds = false;
  try {
    const ids: unknown = JSON.parse(row.allowed_project_ids_json ?? "null");
    validIds = Array.isArray(ids) && ids.length === projects.length && ids.length > 0 &&
      ids.every(id => typeof id === "string" && id.length > 0 && id.length <= 128) && new Set(ids).size === ids.length;
  } catch { /* Corrupt or legacy IDs must be replaced before scanner use. */ }
  return { id: row.id, name: row.name, prefix: row.key_prefix, siteId: row.site_id, projects, createdAt: row.created_at, revokedAt: row.revoked_at, requiresReplacement: !validIds };
}

export class ApiKeyService {
  constructor(private readonly db: Database.Database, private readonly connection?: JiraConnection) {}

  authenticate(secret: unknown) {
    if (typeof secret !== "string" || !/^ih_[A-Za-z0-9_-]{43}$/.test(secret)) return undefined;
    const digest = createHash("sha256").update(secret).digest("hex");
    const row = this.db.prepare("SELECT id, user_id, site_id, allowed_projects_json, allowed_project_ids_json FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL").get(digest) as { id: string; user_id: string; site_id: string; allowed_projects_json: string; allowed_project_ids_json: string | null } | undefined;
    if (!row) return undefined;
    try {
      const projects: unknown = JSON.parse(row.allowed_projects_json);
      const ids: unknown = JSON.parse(row.allowed_project_ids_json ?? "null");
      if (!Array.isArray(projects) || !Array.isArray(ids) || projects.length < 1 || projects.length > 20 || ids.length !== projects.length ||
          !projects.every(p => typeof p === "string" && /^[A-Z][A-Z0-9_]{0,31}$/.test(p)) ||
          !ids.every(id => typeof id === "string" && id.length > 0 && id.length <= 128) ||
          new Set(projects).size !== projects.length || new Set(ids).size !== ids.length) return undefined;
      return { id: row.id, userId: row.user_id, siteId: row.site_id, projects: projects as string[], projectIds: ids as string[] };
    } catch { return undefined; }
  }

  active(userId: string, keyId: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM api_keys WHERE user_id = ? AND id = ? AND revoked_at IS NULL").get(userId, keyId));
  }

  list(userId: string) {
    const rows = this.db.prepare("SELECT id, name, key_prefix, site_id, allowed_projects_json, allowed_project_ids_json, created_at, revoked_at FROM api_keys WHERE user_id = ? ORDER BY revoked_at IS NULL DESC, created_at DESC, id DESC LIMIT 100").all(userId) as KeyRow[];
    return rows.map(publicKey);
  }

  async create(session: SessionRecord, input: { name: string; siteId: string; projects: string[] }) {
    if (!this.connection) throw new ApiKeyError(503, "Jira connection is not configured.");
    const selected = this.db.prepare("SELECT cloud_id FROM jira_sites WHERE user_id = ?").get(session.id) as { cloud_id: string } | undefined;
    if (!selected || selected.cloud_id !== input.siteId) throw new ApiKeyError(409, "Jira site changed. Refresh and select a site.");
    let available: Awaited<ReturnType<JiraConnection["projects"]>>;
    try { available = await this.connection.projects(session.id); }
    catch { throw new ApiKeyError(502, "Could not verify Jira projects. Try again."); }
    // Jira project IDs and keys: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/
    const projectIds = input.projects.map(project => {
      const matches = available.filter(item => item.key === project);
      if (!matches.length) throw new ApiKeyError(403, "One or more projects are not available.");
      if (matches.length !== 1) throw new ApiKeyError(502, "Could not verify Jira projects. Try again.");
      return matches[0].id;
    });
    if (new Set(projectIds).size !== projectIds.length)
      throw new ApiKeyError(502, "Could not verify Jira projects. Try again.");
    const key = `ih_${randomBytes(32).toString("base64url")}`;
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.transaction(() => {
      const active = this.db.prepare("SELECT 1 FROM sessions WHERE id_hash = ? AND user_id = ? AND expires_at > ?").get(session.id_hash, session.id, createdAt);
      if (!active) throw new ApiKeyError(401, "Not signed in");
      const current = this.db.prepare("SELECT cloud_id FROM jira_sites WHERE user_id = ?").get(session.id) as { cloud_id: string } | undefined;
      if (current?.cloud_id !== input.siteId) throw new ApiKeyError(409, "Jira site changed. Refresh and select a site.");
      const count = this.db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL").get(session.id) as { n: number };
      if (count.n >= 20) throw new ApiKeyError(409, "Active API key limit reached.");
      this.db.prepare("INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, site_id, allowed_projects_json, created_at, allowed_project_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, session.id, input.name, key.slice(0, 11), createHash("sha256").update(key).digest("hex"), input.siteId, JSON.stringify(input.projects), createdAt, JSON.stringify(projectIds));
    })();
    return { key, apiKey: { id, name: input.name, prefix: key.slice(0, 11), siteId: input.siteId, projects: input.projects, createdAt, revokedAt: null, requiresReplacement: false } };
  }

  revoke(userId: string, id: string) {
    return this.db.prepare("UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ? AND id = ?").run(new Date().toISOString(), userId, id).changes > 0;
  }
}
