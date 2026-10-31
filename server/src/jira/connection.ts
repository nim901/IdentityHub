import type Database from 'better-sqlite3';
import { getAccessibleResources } from 'jira.js/core';
import { createCloudClient } from 'jira.js/cloud';
import { z } from 'zod';
import type { SessionRecord } from '../db/authRepository.js';
import { JiraOAuth } from './oauth.js';
import { createGuardedFetch } from './tokenExchange.js';

const cloudId = z.string().regex(/^[A-Za-z0-9-]{1,128}$/);
const siteSchema = z.object({ id: cloudId, name: z.string().min(1).max(255), url: z.string().url().max(512), scopes: z.array(z.string().max(128)).max(100) });
const projectsSchema = z.array(z.object({ id: z.string().min(1).max(128), key: z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/), name: z.string().min(1).max(255) })).max(1000);
const projectPageSchema = z.object({ startAt: z.number().int().nonnegative(), isLast: z.boolean(), values: projectsSchema });
export type JiraSite = { id: string; name: string; url: string };

export class JiraConnection {
  constructor(private readonly db: Database.Database, private readonly oauth: JiraOAuth) {}

  status(userId: string) {
    const credential = this.db.prepare("SELECT refresh_status FROM jira_credentials WHERE user_id = ?").get(userId) as { refresh_status: string } | undefined;
    const selected = this.db.prepare('SELECT cloud_id, site_name, site_url FROM jira_sites WHERE user_id = ?').get(userId) as { cloud_id: string; site_name: string; site_url: string } | undefined;
    const connected = credential?.refresh_status === 'ready';
    return { configured: true, connected, site: connected && selected ? { id: selected.cloud_id, name: selected.site_name, url: selected.site_url } : null };
  }

  // Accessible resources and gateway URLs: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
  async sites(userId: string): Promise<JiraSite[]> {
    const { sites } = await this.resources(userId);
    return sites.map(({ id, name, url }) => ({ id, name, url }));
  }

  private async resources(userId: string) {
    const token = await this.oauth.getAccessToken(userId);
    const credentialVersion = this.oauth.credentialVersion(userId, token);
    const fetch = createGuardedFetch({ fetch: this.oauth.transport() }, (url, method) => url.href === 'https://api.atlassian.com/oauth/token/accessible-resources' && method === 'GET', 262144);
    const resources = z.array(siteSchema).max(100).parse(await getAccessibleResources(token, fetch));
    const sites = resources.filter(resource => resource.scopes.includes('read:jira-work')).map(resource => {
      const url = new URL(resource.url);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.atlassian.net') || url.hostname === '.atlassian.net' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid Jira site');
      return { id: resource.id, name: resource.name, url: url.origin, scopes: resource.scopes };
    });
    if (new Set(sites.map(site => site.id)).size !== sites.length) throw new Error('Ambiguous Jira sites');
    return { sites, token, credentialVersion };
  }

  async select(session: SessionRecord, id: string) {
    const { sites, credentialVersion } = await this.resources(session.id);
    const site = sites.find(item => item.id === id);
    if (!site) return false;
    return this.db.transaction(() => {
      const active = this.db.prepare('SELECT 1 FROM sessions WHERE id_hash = ? AND user_id = ? AND expires_at > ?').get(session.id_hash, session.id, new Date().toISOString());
      if (!active) throw new Error('Session expired');
      const unchanged = this.db.prepare("SELECT 1 FROM jira_credentials WHERE user_id = ? AND access_token_enc = ? AND refresh_status = 'ready'").get(session.id, credentialVersion);
      if (!unchanged) throw new Error('Jira connection changed');
      this.db.prepare('INSERT INTO jira_sites (user_id, cloud_id, site_url, site_name) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET cloud_id = excluded.cloud_id, site_url = excluded.site_url, site_name = excluded.site_name')
        .run(session.id, site.id, site.url, site.name);
      return true;
    })();
  }

  async clientFor(userId: string) {
    const selected = this.db.prepare('SELECT cloud_id, site_url FROM jira_sites WHERE user_id = ?').get(userId) as { cloud_id: string; site_url: string } | undefined;
    if (!selected) throw new Error('Jira site not selected');
    const { sites, token, credentialVersion } = await this.resources(userId);
    const resource = sites.find(site => site.id === selected.cloud_id && site.url === selected.site_url);
    if (!resource) throw new Error('Jira site no longer accessible');
    const base = `https://api.atlassian.com/ex/jira/${cloudId.parse(selected.cloud_id)}`;
    const prefix = `/ex/jira/${selected.cloud_id}/rest/api/3`;
    const fetch = createGuardedFetch({ fetch: this.oauth.transport() }, (url, method) => {
      if (url.origin !== 'https://api.atlassian.com' || url.username || url.password || url.hash || url.search.length > 2048) return false;
      if (method === 'GET' && url.pathname === `${prefix}/project/search`) return true;
      if (method === 'GET' && new RegExp(`^${prefix}/issue/createmeta/[A-Z][A-Z0-9_]{0,31}/issuetypes(?:/[0-9]{1,32})?$`).test(url.pathname)) return true;
      return method === 'POST' && url.pathname === `${prefix}/issue` && !url.search;
    }, 1048576);
    // Atlassian's create-field example omits `schema`, which jira.js 6.3.0 requires.
    // Validate the response fields used by this app ourselves: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-createmeta-projectidorkey-issuetypes-issuetypeid-get
    const client = createCloudClient({ host: base, auth: { type: 'bearer', token }, fetch, onSchemaMismatch: 'silent' });
    return { client, site: selected, credentialVersion, canWrite: resource.scopes.includes('write:jira-work') };
  }

  async projects(userId: string) {
    const { client, site, credentialVersion } = await this.clientFor(userId);
    const projects = await this.projectList(client);
    const unchanged = this.db.prepare("SELECT 1 FROM jira_sites s JOIN jira_credentials c ON c.user_id = s.user_id WHERE s.user_id = ? AND s.cloud_id = ? AND s.site_url = ? AND c.access_token_enc = ? AND c.refresh_status = 'ready'")
      .get(userId, site.cloud_id, site.site_url, credentialVersion);
    if (!unchanged) throw new Error('Jira connection changed');
    return projects;
  }

  async projectList(client: Awaited<ReturnType<JiraConnection['clientFor']>>['client']) {
    const projects: unknown[] = [];
    // Project pagination: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/#api-rest-api-3-project-search-get
    for (let startAt = 0; startAt < 1000;) {
      const page = projectPageSchema.parse(await client.projects.searchProjects({ startAt, maxResults: 50 }));
      if (page.startAt !== startAt) throw new Error('Invalid project pagination');
      projects.push(...page.values);
      if (page.isLast) return projectsSchema.parse(projects);
      if (!page.values.length) throw new Error('Invalid project pagination');
      startAt += page.values.length;
    }
    throw new Error('Too many Jira projects');
  }
}
