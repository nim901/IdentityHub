import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { generateAuthorizationUrl } from 'jira.js/core';
import type { SessionRecord } from '../db/authRepository.js';
import { encryptToken, parseEncryptionKey } from './credentials.js';
import { exchangeCode } from './tokenExchange.js';

export type JiraOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string; encryptionKey: string; fetch?: typeof fetch };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// Atlassian requires an unguessable user-bound state: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
export class JiraOAuth {
  private readonly key: Buffer;
  private readonly exchanges = new Set<string>();
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
    return generateAuthorizationUrl({ clientId: this.config.clientId, redirectUri: this.config.redirectUri, state, scopes: ['read:jira-work', 'offline_access'] });
  }

  consume(session: SessionRecord, state: string) {
    return this.db.prepare('DELETE FROM oauth_states WHERE state_hash = ? AND user_id = ? AND session_id_hash = ? AND expires_at > ?')
      .run(hash(state), session.id, session.id_hash, new Date().toISOString()).changes === 1;
  }

  async exchangeAndStore(session: SessionRecord, code: string) {
    if (this.exchanges.has(session.id)) throw new Error('Exchange already in progress');
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
          refresh_token_enc = excluded.refresh_token_enc, access_expires_at = excluded.access_expires_at, scopes = excluded.scopes`)
          .run(session.id, access, refresh, expires, tokens.scope ?? '');
        return true;
      })();
    } finally { this.exchanges.delete(session.id); }
  }
}
