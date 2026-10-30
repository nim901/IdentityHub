import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { generateAuthorizationUrl } from 'jira.js/core';
import type { SessionRecord } from '../db/authRepository.js';
import { decryptToken, encryptToken, parseEncryptionKey } from './credentials.js';
import { exchangeCode, refreshTokens } from './tokenExchange.js';

export type JiraOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string; encryptionKey: string; fetch?: typeof fetch };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// Atlassian requires an unguessable user-bound state: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
export class JiraOAuth {
  private readonly key: Buffer;
  private readonly exchanges = new Set<string>();
  private readonly refreshes = new Map<string, Promise<string>>();
  constructor(private readonly db: Database.Database, private readonly config: JiraOAuthConfig) {
    if (!config.clientId || !config.clientSecret || !config.redirectUri) throw new Error('Invalid Jira configuration');
    const redirect = new URL(config.redirectUri);
    const localHttp = redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if ((!localHttp && redirect.protocol !== 'https:') || redirect.username || redirect.password || redirect.search || redirect.hash) throw new Error('Invalid Jira callback URL');
    this.key = parseEncryptionKey(config.encryptionKey);
  }

  start(session: SessionRecord) {
    const state = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM oauth_states WHERE user_id = ? AND expires_at <= ?').run(session.id, new Date(now).toISOString());
      this.db.prepare('DELETE FROM oauth_states WHERE session_id_hash = ? AND user_id = ?').run(session.id_hash, session.id);
      this.db.prepare('INSERT INTO oauth_states (state_hash, user_id, session_id_hash, expires_at) VALUES (?, ?, ?, ?)')
        .run(hash(state), session.id, session.id_hash, new Date(now + 600_000).toISOString());
    })();
    return generateAuthorizationUrl({ clientId: this.config.clientId, redirectUri: this.config.redirectUri, state, scopes: ['read:jira-work', 'write:jira-work', 'offline_access'] });
  }

  consume(session: SessionRecord, state: string) {
    return this.db.prepare('DELETE FROM oauth_states WHERE state_hash = ? AND user_id = ? AND session_id_hash = ? AND expires_at > ?')
      .run(hash(state), session.id, session.id_hash, new Date().toISOString()).changes === 1;
  }

  async exchangeAndStore(session: SessionRecord, code: string) {
    if (this.exchanges.has(session.id) || this.refreshes.has(session.id)) throw new Error('Credential operation already in progress');
    this.exchanges.add(session.id);
    try {
      const tokens = await exchangeCode(this.config, code);
      const access = encryptToken(this.key, session.id, 'access', tokens.accessToken);
      const refresh = encryptToken(this.key, session.id, 'refresh', tokens.refreshToken);
      const now = new Date().toISOString();
      const expires = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
      return this.db.transaction(() => {
        const active = this.db.prepare('SELECT 1 FROM sessions WHERE id_hash = ? AND user_id = ? AND expires_at > ?').get(session.id_hash, session.id, now);
        if (!active) return false;
        this.db.prepare(`INSERT INTO jira_credentials (user_id, access_token_enc, refresh_token_enc, access_expires_at, scopes)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET access_token_enc = excluded.access_token_enc,
          refresh_token_enc = excluded.refresh_token_enc, access_expires_at = excluded.access_expires_at, scopes = excluded.scopes, refresh_status = 'ready'`)
          .run(session.id, access, refresh, expires, tokens.scope ?? '');
        this.db.prepare('DELETE FROM jira_sites WHERE user_id = ?').run(session.id);
        return true;
      })();
    } finally { this.exchanges.delete(session.id); }
  }

  transport() { return this.config.fetch; }

  credentialVersion(userId: string, token: string): string {
    const row = this.db.prepare("SELECT access_token_enc FROM jira_credentials WHERE user_id = ? AND refresh_status = 'ready'").get(userId) as { access_token_enc: string } | undefined;
    if (!row || decryptToken(this.key, userId, 'access', row.access_token_enc) !== token) throw new Error('Jira connection changed');
    return row.access_token_enc;
  }

  async getAccessToken(userId: string): Promise<string> {
    if (this.exchanges.has(userId)) throw new Error('Credential operation already in progress');
    const existing = this.refreshes.get(userId);
    if (existing) return existing;
    const row = this.db.prepare('SELECT access_token_enc, refresh_token_enc, access_expires_at, refresh_status FROM jira_credentials WHERE user_id = ?').get(userId) as
      { access_token_enc: string; refresh_token_enc: string; access_expires_at: string; refresh_status: string } | undefined;
    if (!row || row.refresh_status !== 'ready') throw new Error('Jira reconnection required');
    if (Date.parse(row.access_expires_at) > Date.now() + 60_000) return decryptToken(this.key, userId, 'access', row.access_token_enc);
    const work = this.rotate(userId, row.refresh_token_enc);
    this.refreshes.set(userId, work);
    try { return await work; } finally { this.refreshes.delete(userId); }
  }

  private async rotate(userId: string, previous: string): Promise<string> {
    const marked = this.db.prepare("UPDATE jira_credentials SET refresh_status = 'refreshing' WHERE user_id = ? AND refresh_status = 'ready' AND refresh_token_enc = ?").run(userId, previous);
    if (marked.changes !== 1) throw new Error('Jira reconnection required');
    try {
      const token = decryptToken(this.key, userId, 'refresh', previous);
      const next = await refreshTokens(this.config, token);
      const access = encryptToken(this.key, userId, 'access', next.accessToken);
      const refresh = encryptToken(this.key, userId, 'refresh', next.refreshToken);
      const expiry = new Date(Date.now() + next.expiresIn * 1000).toISOString();
      const updated = this.db.prepare("UPDATE jira_credentials SET access_token_enc = ?, refresh_token_enc = ?, access_expires_at = ?, scopes = COALESCE(?, scopes), refresh_status = 'ready' WHERE user_id = ? AND refresh_status = 'refreshing' AND refresh_token_enc = ?")
        .run(access, refresh, expiry, next.scope ?? null, userId, previous);
      if (updated.changes !== 1) throw new Error('Jira reconnection required');
      return next.accessToken;
    } catch {
      this.db.prepare("UPDATE jira_credentials SET refresh_status = 'reauthorize' WHERE user_id = ? AND refresh_status = 'refreshing' AND refresh_token_enc = ?").run(userId, previous);
      throw new Error('Jira reconnection required');
    }
  }
}
