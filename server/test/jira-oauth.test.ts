import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { createFakeAtlassian } from '../src/fake-atlassian/service.js';
import { createTwoUsers, sessionCookie } from './helpers/users.js';
import { Writable } from 'node:stream';
import { openDatabase } from '../src/db/database.js';
import { JiraOAuth } from '../src/jira/oauth.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const fake = createFakeAtlassian('http://localhost:3000/api/jira/callback');
const config = {
  clientId: 'mock-client-id', clientSecret: 'mock-client-secret',
  redirectUri: 'http://localhost:3000/api/jira/callback',
  encryptionKey: Buffer.alloc(32, 7).toString('base64'),
  fetch: (async (input, init) => {
    if (String(input) !== 'https://auth.atlassian.com/oauth/token') throw new Error('Unexpected destination');
    const response = await fake.inject({ method: 'POST', url: '/oauth/token', headers: Object.fromEntries(new Headers(init?.headers)), payload: String(init?.body) });
    return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch,
};
afterAll(async () => fake.close());
afterEach(async () => { vi.useRealTimers(); await Promise.all(apps.splice(0).map(app => app.close())); });

describe('Jira OAuth state', () => {
  it('stores only a state hash and removes pending state when its session is deleted', () => {
    const db = openDatabase(':memory:');
    try {
      db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run('user', 'user@example.test', 'hash', '2026-01-01');
      db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run('other', 'other@example.test', 'hash', '2026-01-01');
      db.prepare('INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run('session-hash', 'user', 'csrf', '2026-01-01', '2099-01-01');
      db.prepare('INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run('other-session', 'other', 'csrf', '2026-01-01', '2099-01-01');
      db.prepare('INSERT INTO oauth_states (state_hash, user_id, session_id_hash, expires_at) VALUES (?, ?, ?, ?)').run('other-state', 'other', 'other-session', '2000-01-01');
      const oauth = new JiraOAuth(db, config);
      const state = new URL(oauth.start({ id: 'user', email: 'user@example.test', id_hash: 'session-hash', csrf_token: 'csrf' })).searchParams.get('state');
      const stored = db.prepare('SELECT state_hash FROM oauth_states WHERE user_id = ?').get('user') as { state_hash: string };
      expect(stored.state_hash).not.toBe(state);
      expect(stored.state_hash).toMatch(/^[a-f0-9]{64}$/);
      db.prepare('DELETE FROM sessions WHERE id_hash = ?').run('session-hash');
      expect(db.prepare('SELECT COUNT(*) AS count FROM oauth_states WHERE user_id = ?').get('user')).toEqual({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM oauth_states WHERE user_id = ?').get('other')).toEqual({ count: 1 });
    } finally { db.close(); }
  });
  it('does not log callback query parameters', async () => {
    let logs = '';
    const stream = new Writable({ write(chunk, _encoding, done) { logs += chunk.toString(); done(); } });
    const app = await buildApp({ databasePath: ':memory:', loggerStream: stream });
    apps.push(app);
    await app.inject({ url: '/api/jira/callback?code=private-code&state=private-state' });
    expect(logs).toContain('/api/jira/callback');
    expect(logs).not.toContain('private-code');
    expect(logs).not.toContain('private-state');
  });
  it('binds state to the initiating session, expires it, and prevents replay', async () => {
    const app = await buildApp({ databasePath: ':memory:', jiraOAuth: config });
    apps.push(app);
    const { a, b } = await createTwoUsers(app);
    const start = () => app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } });
    expect((await app.inject({ method: 'POST', url: '/api/jira/connect' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: a.cookie } })).statusCode).toBe(403);
    const result = await start();
    expect(result.statusCode).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    const authorization = new URL(result.json().authorizationUrl);
    const redirect = await fake.inject({ url: authorization.pathname + authorization.search });
    expect(redirect.statusCode).toBe(302);
    const callback = new URL(redirect.headers.location!);
    const path = callback.pathname + callback.search;
    expect((await app.inject({ url: '/api/jira/callback?code=fake-code&state=wrong', headers: { cookie: a.cookie } })).headers.location).toBe('/?jira=failed');
    expect((await app.inject({ url: path, headers: { cookie: b.cookie } })).headers.location).toBe('/?jira=failed');
    const secondLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: a.credentials });
    expect((await app.inject({ url: path, headers: { cookie: sessionCookie(secondLogin.headers['set-cookie']) } })).headers.location).toBe('/?jira=failed');
    const concurrent = await Promise.all([app.inject({ url: path, headers: { cookie: a.cookie } }), app.inject({ url: path, headers: { cookie: a.cookie } })]);
    expect(concurrent.map(response => response.statusCode).sort()).toEqual([303, 303]);
    expect(concurrent.find(response => response.headers.location === '/?jira=connected')?.headers['referrer-policy']).toBe('no-referrer');
    expect(concurrent.find(response => response.headers.location === '/?jira=connected')?.headers['cache-control']).toBe('no-store');
    expect(concurrent.find(response => response.headers.location === '/?jira=connected')?.headers.location).toBe('/?jira=connected');
    const deniedStart = await start();
    const deniedState = new URL(deniedStart.json().authorizationUrl).searchParams.get('state');
    const deniedPath = `/api/jira/callback?error=access_denied&state=${deniedState}`;
    expect((await app.inject({ url: deniedPath, headers: { cookie: a.cookie } })).statusCode).toBe(303);
    expect((await app.inject({ url: deniedPath, headers: { cookie: a.cookie } })).headers.location).toBe('/?jira=failed');
    const next = await start();
    const state = new URL(next.json().authorizationUrl).searchParams.get('state');
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect((await app.inject({ url: `/api/jira/callback?code=fake-code&state=${state}`, headers: { cookie: a.cookie } })).headers.location).toBe('/?jira=failed');
    vi.useRealTimers();
    const pending = await start();
    const pendingState = new URL(pending.json().authorizationUrl).searchParams.get('state');
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/jira/callback?code=fake-code&state=${pendingState}`, headers: { cookie: a.cookie } })).headers.location).toBe('/?jira=expired');
  }, 20000);
});
