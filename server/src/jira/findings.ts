import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { isApiError } from 'jira.js/core';
import { z } from 'zod';
import type { SessionRecord } from '../db/authRepository.js';
import { JiraConnection } from './connection.js';

export type FindingInput = { project: string; title: string; description: string };
export class FindingError extends Error {
  constructor(public status: number, message: string, public issueKey?: string) { super(message); }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const issueId = z.string().regex(/^[0-9]{1,32}$/);
const issueKey = z.string().regex(/^[A-Z][A-Z0-9_]{0,31}-[1-9][0-9]{0,19}$/);
const issueTypeSchema = z.object({ id: z.string().regex(/^[0-9]{1,32}$/), name: z.string().max(255), subtask: z.boolean() });
const fieldSchema = z.object({ fieldId: z.string().min(1).max(255), operations: z.array(z.string().max(128)).max(50), required: z.boolean(), hasDefaultValue: z.boolean().optional() });
const metadataPage = { startAt: z.number().int().nonnegative(), total: z.number().int().min(0).max(1000) };
const typesPage = z.object({ ...metadataPage, issueTypes: z.array(issueTypeSchema).max(1000).optional(), createMetaIssueType: z.array(issueTypeSchema).max(1000).optional() });
const fieldsPage = z.object({ ...metadataPage, fields: z.array(fieldSchema).max(1000).optional(), results: z.array(fieldSchema).max(1000).optional() });
type Client = Awaited<ReturnType<JiraConnection['clientFor']>>['client'];

// Jira create metadata and ADF requirements: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
export class FindingsService {
  private readonly queues = new Map<string, { tail: Promise<void>; count: number }>();
  constructor(private readonly db: Database.Database, private readonly connection: JiraConnection, private readonly defaultIssueType?: string) {}

  recent(userId: string, project: string, expectedSiteId?: string) {
    const site = this.db.prepare('SELECT cloud_id FROM jira_sites WHERE user_id = ?').get(userId) as { cloud_id: string } | undefined;
    if (expectedSiteId && site?.cloud_id !== expectedSiteId) throw new FindingError(409, 'Jira site changed.');
    if (!site) return [];
    const rows = this.db.prepare('SELECT issue_key, title, site_url, created_at FROM created_issues WHERE user_id = ? AND cloud_id = ? AND project_key = ? ORDER BY created_at DESC, issue_key DESC LIMIT 10')
      .all(userId, site.cloud_id, project) as Array<{ issue_key: string; title: string; site_url: string; created_at: string }>;
    return rows.map(row => ({ issueKey: row.issue_key, title: row.title, createdAt: row.created_at, url: `${row.site_url}/browse/${row.issue_key}` }));
  }

  async create(session: SessionRecord, input: FindingInput, idempotencyKey: string, expectedSiteId?: string) {
    const { client, site, credentialVersion, canWrite } = await this.connection.clientFor(session.id);
    if (expectedSiteId && site.cloud_id !== expectedSiteId) throw new FindingError(409, 'Jira site changed.');
    return this.enqueue(site.cloud_id, async () => {
      if (!canWrite) throw new FindingError(403, 'Reconnect Jira to grant issue creation access.');
      const keyHash = hash(idempotencyKey);
      const requestHash = hash(JSON.stringify([site.cloud_id, input.project, input.title, input.description]));
      const existing = this.operation(session.id, keyHash);
      if (existing) return this.previous(session.id, site.cloud_id, existing, requestHash);
      const projects = await this.connection.projectList(client);
      if (!projects.some(project => project.key === input.project)) throw new FindingError(403, 'Jira project is not available.');
      const type = await this.chooseIssueType(client, input.project);
      const active = this.db.prepare('SELECT 1 FROM sessions WHERE id_hash = ? AND user_id = ? AND expires_at > ?').get(session.id_hash, session.id, new Date().toISOString());
      if (!active) throw new FindingError(401, 'Not signed in');
      const unchanged = this.db.prepare("SELECT 1 FROM jira_sites s JOIN jira_credentials c ON c.user_id = s.user_id WHERE s.user_id = ? AND s.cloud_id = ? AND s.site_url = ? AND c.access_token_enc = ? AND c.refresh_status = 'ready'")
        .get(session.id, site.cloud_id, site.site_url, credentialVersion);
      if (!unchanged) throw new FindingError(409, 'Jira connection changed. Try again.');
      const reserved = this.db.prepare("INSERT INTO finding_operations (user_id, key_hash, request_hash, status) VALUES (?, ?, ?, 'pending') ON CONFLICT(user_id, key_hash) DO NOTHING")
        .run(session.id, keyHash, requestHash);
      if (!reserved.changes) return this.previous(session.id, site.cloud_id, this.operation(session.id, keyHash)!, requestHash);

      let created: { id: string; key: string };
      try {
        const result = await client.issues.createIssue({ fields: {
          project: { key: input.project }, issuetype: { id: type }, summary: input.title,
          description: { type: 'doc', version: 1, content: input.description.split(/\r\n|\r|\n/).map(line => line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }) },
        } });
        created = { id: issueId.parse(result.id), key: issueKey.parse(result.key) };
        if (!created.key.startsWith(`${input.project}-`)) throw new Error('Unexpected issue project');
      } catch (error) {
        if (isApiError(error) && [400, 401, 403, 404, 422, 429].includes(error.status)) {
          this.db.prepare("DELETE FROM finding_operations WHERE user_id = ? AND key_hash = ? AND status = 'pending'").run(session.id, keyHash);
          throw new FindingError(error.status === 429 ? 429 : 502, 'Jira rejected the finding.');
        }
        this.markUnknown(session.id, keyHash);
        throw new FindingError(502, 'The Jira outcome is unknown. Check Jira before retrying.');
      }

      try {
        this.db.transaction(() => {
          this.db.prepare('INSERT INTO created_issues (user_id, cloud_id, project_key, issue_key, issue_id, title, site_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(session.id, site.cloud_id, input.project, created.key, created.id, input.title, site.site_url, new Date().toISOString());
          this.db.prepare("UPDATE finding_operations SET status = 'done', issue_key = ? WHERE user_id = ? AND key_hash = ? AND status = 'pending'").run(created.key, session.id, keyHash);
        })();
      } catch {
        this.markUnknown(session.id, keyHash);
        throw new FindingError(502, 'Jira created the issue, but local recording failed. Do not retry.', created.key);
      }
      return { issueKey: created.key, url: `${site.site_url}/browse/${created.key}`, replay: false };
    });
  }

  private operation(userId: string, keyHash: string) {
    return this.db.prepare('SELECT request_hash, status, issue_key FROM finding_operations WHERE user_id = ? AND key_hash = ?').get(userId, keyHash) as
      { request_hash: string; status: string; issue_key: string | null } | undefined;
  }

  private previous(userId: string, cloudId: string, operation: { request_hash: string; status: string; issue_key: string | null }, requestHash: string) {
    if (operation.request_hash !== requestHash) throw new FindingError(409, 'Idempotency key already used for a different request.');
    if (operation.status !== 'done' || !operation.issue_key) throw new FindingError(409, 'The earlier Jira outcome is unresolved. Check Jira before retrying.');
    const row = this.db.prepare('SELECT site_url FROM created_issues WHERE user_id = ? AND cloud_id = ? AND issue_key = ?').get(userId, cloudId, operation.issue_key) as { site_url: string } | undefined;
    if (!row) throw new FindingError(409, 'The earlier Jira outcome is unresolved.');
    return { issueKey: operation.issue_key, url: `${row.site_url}/browse/${operation.issue_key}`, replay: true };
  }

  private markUnknown(userId: string, keyHash: string) {
    try { this.db.prepare("UPDATE finding_operations SET status = 'unknown' WHERE user_id = ? AND key_hash = ? AND status = 'pending'").run(userId, keyHash); } catch { /* Pending is also treated as unresolved. */ }
  }

  private async chooseIssueType(client: Client, project: string): Promise<string> {
    const types: Array<{ id: string; name: string }> = [];
    for (let startAt = 0; startAt < 1000;) {
      const page = typesPage.parse(await client.issues.getCreateIssueMetaIssueTypes({ projectIdOrKey: project, startAt, maxResults: 50 }));
      const entries = page.issueTypes ?? page.createMetaIssueType;
      if (!entries || !Number.isInteger(page.total) || page.total! > 1000 || page.startAt !== startAt) throw new FindingError(502, 'Jira issue metadata is unavailable.');
      for (const item of entries) if (item.subtask === false && item.id && /^[0-9]{1,32}$/.test(item.id)) types.push({ id: item.id, name: item.name ?? '' });
      startAt += entries.length;
      if (startAt >= page.total!) break;
      if (!entries.length) throw new FindingError(502, 'Jira issue metadata is incomplete.');
    }
    types.sort((a, b) => Number(b.name === this.defaultIssueType) - Number(a.name === this.defaultIssueType) || Number(b.name === 'Task') - Number(a.name === 'Task') || a.id.localeCompare(b.id));
    for (const type of types) {
      const fields: Array<{ fieldId: string; operations: string[]; required: boolean; hasDefaultValue?: boolean }> = [];
      for (let startAt = 0; startAt < 1000;) {
        const page = fieldsPage.parse(await client.issues.getCreateIssueMetaIssueTypeId({ projectIdOrKey: project, issueTypeId: type.id, startAt, maxResults: 50 }));
        const entries = page.fields ?? page.results;
        if (!entries || !Number.isInteger(page.total) || page.total! > 1000 || page.startAt !== startAt) throw new FindingError(502, 'Jira field metadata is unavailable.');
        fields.push(...entries);
        startAt += entries.length;
        if (startAt >= page.total!) break;
        if (!entries.length) throw new FindingError(502, 'Jira field metadata is incomplete.');
      }
      const supported = new Set(['project', 'issuetype', 'summary', 'description']);
      if (['summary', 'description'].every(id => fields.some(field => field.fieldId === id && field.operations.includes('set'))) &&
          fields.every(field => !field.required || field.hasDefaultValue || supported.has(field.fieldId))) return type.id;
    }
    throw new FindingError(422, 'No supported Jira issue type is available for this project.');
  }

  private async enqueue<T>(site: string, task: () => Promise<T>): Promise<T> {
    const queue = this.queues.get(site) ?? { tail: Promise.resolve(), count: 0 };
    if (queue.count >= 20) throw new FindingError(503, 'Jira is busy. Try again later.');
    queue.count++;
    this.queues.set(site, queue);
    const previous = queue.tail;
    let release!: () => void;
    queue.tail = new Promise<void>(resolve => { release = resolve; });
    try { await previous; return await task(); }
    finally { release(); if (--queue.count === 0) this.queues.delete(site); }
  }
}
