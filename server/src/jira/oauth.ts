import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { generateAuthorizationUrl } from 'jira.js/core';
import type { SessionRecord } from '../db/authRepository.js';

export type JiraOAuthConfig = { clientId: string; redirectUri: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// Atlassian requires an unguessable user-bound state: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
export class JiraOAuth {
  constructor(private readonly db: Database.Database, private readonly config: JiraOAuthConfig) {}

  start(session: SessionRecord) {
    const state = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM oauth_states WHERE user_id = ? AND expires_at <= ?').run(session.id, new Date(now).toISOString());
      this.db.prepare('DELETE FROM oauth_states WHERE session_id_hash = ? AND user_id = ?').run(session.id_hash, session.id);
      this.db.prepare('INSERT INTO oauth_states (state_hash, user_id, session_id_hash, expires_at) VALUES (?, ?, ?, ?)')
        .run(hash(state), session.id, session.id_hash, new Date(now + 600_000).toISOString());
    })();
    return generateAuthorizationUrl({ clientId: this.config.clientId, redirectUri: this.config.redirectUri, state, scopes: ['read:jira-work'] });
  }

  consume(session: SessionRecord, state: string) {
    return this.db.prepare('DELETE FROM oauth_states WHERE state_hash = ? AND user_id = ? AND session_id_hash = ? AND expires_at > ?')
      .run(hash(state), session.id, session.id_hash, new Date().toISOString()).changes === 1;
  }
}
