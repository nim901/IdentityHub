import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { JiraOAuth } from '../src/jira/oauth.js';
import { decryptToken, encryptToken, parseEncryptionKey } from '../src/jira/credentials.js';

const keyValue = Buffer.alloc(32, 7).toString('base64');
const key = parseEncryptionKey(keyValue);
const connections: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const db of connections.splice(0)) db.close(); });

function setup(fetchFake: typeof fetch) {
  const db = openDatabase(':memory:'); connections.push(db);
  for (const user of ['alice', 'bob']) {
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(user, `${user}@example.test`, 'hash', '2026-01-01');
    db.prepare('INSERT INTO jira_credentials (user_id, access_token_enc, refresh_token_enc, access_expires_at, scopes) VALUES (?, ?, ?, ?, ?)')
      .run(user, encryptToken(key, user, 'access', `old-access-${user}`), encryptToken(key, user, 'refresh', `old-refresh-${user}`), '2000-01-01T00:00:00.000Z', 'read:jira-work');
  }
  const oauth = new JiraOAuth(db, { clientId: 'mock-client-id', clientSecret: 'mock-client-secret', redirectUri: 'http://localhost:3000/api/jira/callback', encryptionKey: keyValue, fetch: fetchFake });
  return { db, oauth };
}

describe('Jira refresh token rotation', () => {
  it('shares concurrent refreshes and persists rotated encrypted tokens for only that user', async () => {
    let requests = 0;
    const fake: typeof fetch = async (_url, init) => {
      requests++;
      expect(init?.redirect).toBe('error');
      expect(JSON.parse(String(init?.body))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'old-refresh-alice' });
      await new Promise(resolve => setTimeout(resolve, 20));
      return Response.json({ access_token: 'new-access-alice', refresh_token: 'new-refresh-alice', expires_in: 3600 });
    };
    const { db, oauth } = setup(fake);
    const tokens = await Promise.all([oauth.getAccessToken('alice'), oauth.getAccessToken('alice')]);
    expect(tokens).toEqual(['new-access-alice', 'new-access-alice']);
    expect(requests).toBe(1);
    const row = db.prepare('SELECT * FROM jira_credentials WHERE user_id = ?').get('alice') as { access_token_enc: string; refresh_token_enc: string; refresh_status: string };
    expect(row.refresh_status).toBe('ready');
    expect(db.prepare('SELECT scopes FROM jira_credentials WHERE user_id = ?').get('alice')).toEqual({ scopes: 'read:jira-work' });
    expect(decryptToken(key, 'alice', 'access', row.access_token_enc)).toBe('new-access-alice');
    expect(decryptToken(key, 'alice', 'refresh', row.refresh_token_enc)).toBe('new-refresh-alice');
    const bob = db.prepare('SELECT refresh_token_enc FROM jira_credentials WHERE user_id = ?').get('bob') as { refresh_token_enc: string };
    expect(decryptToken(key, 'bob', 'refresh', bob.refresh_token_enc)).toBe('old-refresh-bob');
    expect(await oauth.getAccessToken('alice')).toBe('new-access-alice');
    expect(requests).toBe(1);
  });

  it('requires reconnection after a failed or interrupted rotation and never reuses the old token', async () => {
    let requests = 0;
    const fake: typeof fetch = async () => { requests++; return new Response('revoked', { status: 403 }); };
    const { db, oauth } = setup(fake);
    await expect(oauth.getAccessToken('alice')).rejects.toThrow();
    await expect(oauth.getAccessToken('alice')).rejects.toThrow();
    expect(requests).toBe(1);
    expect(db.prepare('SELECT refresh_status FROM jira_credentials WHERE user_id = ?').get('alice')).toEqual({ refresh_status: 'reauthorize' });
    db.prepare("UPDATE jira_credentials SET refresh_status = 'refreshing' WHERE user_id = ?").run('bob');
    await expect(oauth.getAccessToken('bob')).rejects.toThrow();
    expect(requests).toBe(1);
  });

  it('does not reuse a token if saving the rotated pair fails', async () => {
    let requests = 0;
    const fake: typeof fetch = async () => { requests++; return Response.json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 }); };
    const { db, oauth } = setup(fake);
    db.exec("CREATE TRIGGER fail_rotation BEFORE UPDATE ON jira_credentials WHEN NEW.refresh_status = 'ready' BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END");
    await expect(oauth.getAccessToken('alice')).rejects.toThrow();
    expect(db.prepare('SELECT refresh_status FROM jira_credentials WHERE user_id = ?').get('alice')).toEqual({ refresh_status: 'reauthorize' });
    await expect(oauth.getAccessToken('alice')).rejects.toThrow();
    expect(requests).toBe(1);
  });

  it('does not share refreshes between users', async () => {
    const seen: string[] = [];
    const fake: typeof fetch = async (_url, init) => {
      const token = JSON.parse(String(init?.body)).refresh_token as string;
      seen.push(token);
      await new Promise(resolve => setTimeout(resolve, 20));
      return Response.json({ access_token: `new-${token}`, refresh_token: `rotated-${token}`, expires_in: 3600 });
    };
    const { oauth } = setup(fake);
    const results = await Promise.all([oauth.getAccessToken('alice'), oauth.getAccessToken('bob')]);
    expect(results).toEqual(['new-old-refresh-alice', 'new-old-refresh-bob']);
    expect(seen.sort()).toEqual(['old-refresh-alice', 'old-refresh-bob']);
  });
});
