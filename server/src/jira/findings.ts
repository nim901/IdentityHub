import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { isApiError } from 'jira.js/core';
import { z } from 'zod';
import type { SessionRecord } from '../db/authRepository.js';
import { JiraConnection } from './connection.js';

export type FindingInput = { project: string; title: string; description: string };
export type FindingActor = { kind: 'session'; session: SessionRecord } | { kind: 'digest'; userId: string } | { kind: 'apiKey'; userId: string; siteId: string; projectId: string; requestIdentity: string; active: () => boolean };
export class FindingError extends Error {
  constructor(public status: number, message: string, public issueKey?: string, public definiteRejection = false) { super(message); }
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

  async create(session: SessionRecord, input: FindingInput, idempotencyKey: string, expectedSiteId?: string): Promise<{ issueKey: string; url: string; replay: boolean }>;
  async create(session: FindingActor, input: FindingInput, idempotencyKey: string, expectedSiteId?: string): Promise<{ issueKey: string; url: string; replay: boolean }>;
  async create(actor: SessionRecord | FindingActor, input: FindingInput, idempotencyKey: string, expectedSiteId?: string) {
    const principal: FindingActor = 'kind' in actor ? actor : { kind: 'session', session: actor };
    const userId = principal.kind === 'session' ? principal.session.id : principal.userId;
    if (principal.kind === 'apiKey') {
      const selected = this.db.prepare('SELECT cloud_id FROM jira_sites WHERE user_id = ?').get(userId) as { cloud_id: string } | undefined;
      if (selected?.cloud_id !== principal.siteId) throw new FindingError(403, 'API key site is not selected.');
    }
    const { client, site, credentialVersion, canWrite } = await this.connection.clientFor(userId);
    if (principal.kind === 'apiKey' && site.cloud_id !== principal.siteId) throw new FindingError(403, 'API key site is not selected.');
    if (expectedSiteId && site.cloud_id !== expectedSiteId) throw new FindingError(409, 'Jira site changed.', undefined, true);
    return this.enqueue(site.cloud_id, async () => {
      if (!canWrite) throw new FindingError(403, 'Reconnect Jira to grant issue creation access.');
      const keyHash = hash(idempotencyKey);
      const requestHash = principal.kind === 'apiKey'
        ? hash(JSON.stringify([site.cloud_id, principal.requestIdentity]))
        : hash(JSON.stringify([site.cloud_id, input.project, input.title, input.description]));
      if (principal.kind === 'apiKey' && !principal.active()) throw new FindingError(401, 'Invalid API key');
      const existing = this.operation(userId, keyHash);
      if (existing && principal.kind !== 'apiKey') return this.previous(userId, site.cloud_id, existing, requestHash);
      const projects = await this.connection.projectList(client);
      const matches = projects.filter(project => project.key === input.project);
      if (!matches.length) throw new FindingError(principal.kind === 'apiKey' ? 404 : 403, 'Jira project is not available.');
      if (matches.length !== 1) throw new FindingError(502, 'Could not verify Jira projects.');
      if (principal.kind === 'apiKey' && matches[0].id !== principal.projectId) throw new FindingError(403, 'Project is not permitted.');
      if (existing) {
        if (principal.kind === 'apiKey' && !principal.active()) throw new FindingError(401, 'Invalid API key');
        const unchanged = this.db.prepare("SELECT 1 FROM jira_sites s JOIN jira_credentials c ON c.user_id = s.user_id WHERE s.user_id = ? AND s.cloud_id = ? AND s.site_url = ? AND c.access_token_enc = ? AND c.refresh_status = 'ready'")
          .get(userId, site.cloud_id, site.site_url, credentialVersion);
        if (!unchanged) throw new FindingError(409, 'Jira connection changed. Try again.');
        return this.previous(userId, site.cloud_id, existing, requestHash);
      }
      const type = await this.chooseIssueType(client, input.project);
      const active = principal.kind === 'session' ? this.db.prepare('SELECT 1 FROM sessions WHERE id_hash = ? AND user_id = ? AND expires_at > ?').get(principal.session.id_hash, userId, new Date().toISOString()) : principal.kind === 'apiKey' ? principal.active() : this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId);
      if (!active) throw new FindingError(401, principal.kind === 'session' ? 'Not signed in' : 'Invalid API key');
      const unchanged = this.db.prepare("SELECT 1 FROM jira_sites s JOIN jira_credentials c ON c.user_id = s.user_id WHERE s.user_id = ? AND s.cloud_id = ? AND s.site_url = ? AND c.access_token_enc = ? AND c.refresh_status = 'ready'")
        .get(userId, site.cloud_id, site.site_url, credentialVersion);
      if (!unchanged) throw new FindingError(409, 'Jira connection changed. Try again.');
      const reserved = this.db.prepare("INSERT INTO finding_operations (user_id, key_hash, request_hash, status) VALUES (?, ?, ?, 'pending') ON CONFLICT(user_id, key_hash) DO NOTHING")
        .run(userId, keyHash, requestHash);
      if (!reserved.changes) return this.previous(userId, site.cloud_id, this.operation(userId, keyHash)!, requestHash);

      let created: { id: string; key: string };
      try {
        // Atlassian's Cloud create-issue example uses project.id: https://developer.atlassian.com/cloud/jira/platform/rest/v2/api-group-issues/#api-rest-api-2-issue-post
        const result = await client.issues.createIssue({ fields: {
          project: principal.kind === 'apiKey' ? { id: principal.projectId } : { key: input.project }, issuetype: { id: type }, summary: input.title,
          description: { type: 'doc', version: 1, content: input.description.split(/\r\n|\r|\n/).map(line => line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }) },
        } });
        created = { id: issueId.parse(result.id), key: issueKey.parse(result.key) };
        if (!created.key.startsWith(`${input.project}-`)) throw new Error('Unexpected issue project');
      } catch (error) {
        if (isApiError(error) && [400, 401, 403, 404, 422, 429].includes(error.status)) {
          this.db.prepare("DELETE FROM finding_operations WHERE user_id = ? AND key_hash = ? AND status = 'pending'").run(userId, keyHash);
          throw new FindingError(error.status === 429 ? 429 : 502, 'Jira rejected the finding.', undefined, true);
        }
        this.markUnknown(userId, keyHash);
        throw new FindingError(502, 'The Jira outcome is unknown. Check Jira before retrying.');
      }

      try {
        this.db.transaction(() => {
          this.db.prepare('INSERT INTO created_issues (user_id, cloud_id, project_key, issue_key, issue_id, title, site_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(userId, site.cloud_id, input.project, created.key, created.id, input.title, site.site_url, new Date().toISOString());
          this.db.prepare("UPDATE finding_operations SET status = 'done', issue_key = ? WHERE user_id = ? AND key_hash = ? AND status = 'pending'").run(created.key, userId, keyHash);
        })();
      } catch {
        this.markUnknown(userId, keyHash);
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
