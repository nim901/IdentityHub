import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { buildApp } from '../src/app.js';
import { createFakeAtlassian } from '../src/fake-atlassian/service.js';
import { createTwoUsers, sessionCookie } from './helpers/users.js';
import { decryptToken, encryptToken, parseEncryptionKey } from '../src/jira/credentials.js';
import { Writable } from 'node:stream';

const callback = 'http://localhost:3000/api/jira/callback';
const key = Buffer.alloc(32, 7).toString('base64');

describe('Jira token exchange', () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  it('authenticates ciphertext, token type, user, and key', () => {
    const encryptionKey = parseEncryptionKey(key);
    const encrypted = encryptToken(encryptionKey, 'alice', 'access', 'fake-token');
    expect(decryptToken(encryptionKey, 'alice', 'access', encrypted)).toBe('fake-token');
    expect(() => decryptToken(encryptionKey, 'bob', 'access', encrypted)).toThrow();
    expect(() => decryptToken(encryptionKey, 'alice', 'refresh', encrypted)).toThrow();
    expect(() => decryptToken(Buffer.alloc(32, 8), 'alice', 'access', encrypted)).toThrow();
    const parts = encrypted.split(':');
    const bytes = Buffer.from(parts[3], 'base64'); bytes[0] ^= 1; parts[3] = bytes.toString('base64');
    expect(() => decryptToken(encryptionKey, 'alice', 'access', parts.join(':'))).toThrow();
    expect(() => parseEncryptionKey('not-a-key')).toThrow();
  });
  it('fails closed when the encryption key is invalid', async () => {
    let called = false;
    const fetchFake: typeof fetch = async () => { called = true; throw new Error('Unexpected network'); };
    const app = await buildApp({ databasePath: ':memory:', jiraOAuth: { clientId: 'mock-client-id', clientSecret: 'mock-client-secret', redirectUri: callback, encryptionKey: 'invalid', fetch: fetchFake } }); apps.push(app);
    const { a } = await createTwoUsers(app);
    const result = await app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } });
    expect(result.statusCode).toBe(503);
    expect((await app.inject({ url: '/api/jira/status', headers: { cookie: a.cookie } })).json()).toEqual({ configured: false, connected: false, site: null });
    expect(called).toBe(false);
  }, 30000);
  it('fails closed instead of ignoring a configured fake authorization base', async () => {
    vi.stubEnv('ATLASSIAN_CLIENT_ID', 'mock-client-id');
    vi.stubEnv('ATLASSIAN_CLIENT_SECRET', 'mock-client-secret');
    vi.stubEnv('OAUTH_REDIRECT_URI', callback);
    vi.stubEnv('ENCRYPTION_KEY', key);
    vi.stubEnv('ATLASSIAN_AUTH_BASE', 'http://127.0.0.1:4010');
    const app = await buildApp({ databasePath: ':memory:' }); apps.push(app);
    const { a } = await createTwoUsers(app);
    expect((await app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } })).statusCode).toBe(503);
  }, 30000);
  it('exchanges a single-use callback and stores encrypted credentials for the session user', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'identityhub-oauth-')); dirs.push(dir);
    const path = join(dir, 'test.db');
    const fake = createFakeAtlassian(callback);
    let requests = 0;
    let rejectExchange = false;
    const fetchFake: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('https://auth.atlassian.com/oauth/token');
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeDefined();
      requests++;
      if (rejectExchange) return new Response('private-upstream-detail', { status: 400 });
      const response = await fake.inject({ method: 'POST', url: '/oauth/token', headers: Object.fromEntries(new Headers(init?.headers)), payload: String(init?.body) });
      return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } });
    };
    const app = await buildApp({ databasePath: path, jiraOAuth: { clientId: 'mock-client-id', clientSecret: 'mock-client-secret', redirectUri: callback, encryptionKey: key, fetch: fetchFake } }); apps.push(app);
    const { a, b } = await createTwoUsers(app);
    const start = await app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } });
    const authorization = new URL(start.json().authorizationUrl);
    expect(authorization.searchParams.get('scope')).toContain('offline_access');
    const redirect = await fake.inject({ url: authorization.pathname + authorization.search });
    const url = new URL(redirect.headers.location!);
    const pathAndQuery = url.pathname + url.search;
    expect((await app.inject({ url: pathAndQuery, headers: { cookie: b.cookie } })).headers.location).toBe('/?jira=failed');
    const result = await app.inject({ url: pathAndQuery, headers: { cookie: a.cookie } });
    expect(result.statusCode).toBe(303);
    expect(result.body).not.toContain('fake-access-token');
    expect(result.body).not.toContain('fake-refresh-token');
    expect((await app.inject({ url: pathAndQuery, headers: { cookie: a.cookie } })).headers.location).toBe('/?jira=failed');
    expect(requests).toBe(1);
    const db = new Database(path, { readonly: true });
    try {
      const rows = db.prepare('SELECT user_id, access_token_enc, refresh_token_enc FROM jira_credentials').all() as Array<{ user_id: string; access_token_enc: string; refresh_token_enc: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe((await app.inject({ url: '/api/auth/session', headers: { cookie: a.cookie } })).json().user.id);
      expect(JSON.stringify(rows)).not.toContain('fake-access-token');
      expect(JSON.stringify(rows)).not.toContain('fake-refresh-token');
      expect(decryptToken(parseEncryptionKey(key), rows[0].user_id, 'access', rows[0].access_token_enc)).toBe('fake-access-token');
      expect(decryptToken(parseEncryptionKey(key), rows[0].user_id, 'refresh', rows[0].refresh_token_enc)).toBe('fake-refresh-token');
      rejectExchange = true;
      const retry = await app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } });
      const retryState = new URL(retry.json().authorizationUrl).searchParams.get('state');
      expect((await app.inject({ url: `/api/jira/callback?code=fake-code&state=${retryState}`, headers: { cookie: a.cookie } })).statusCode).toBe(303);
      expect(db.prepare('SELECT user_id, access_token_enc, refresh_token_enc FROM jira_credentials').all()).toEqual(rows);
      rejectExchange = false;
      const bStart = await app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: b.cookie, 'x-csrf-token': b.csrfToken } });
      const bState = new URL(bStart.json().authorizationUrl).searchParams.get('state');
      expect((await app.inject({ url: `/api/jira/callback?code=fake-code&state=${bState}`, headers: { cookie: b.cookie } })).statusCode).toBe(303);
      const bId = (await app.inject({ url: '/api/auth/session', headers: { cookie: b.cookie } })).json().user.id;
      const bRow = db.prepare('SELECT access_token_enc FROM jira_credentials WHERE user_id = ?').get(bId) as { access_token_enc: string };
      expect(decryptToken(parseEncryptionKey(key), bId, 'access', bRow.access_token_enc)).toBe('fake-access-token');
      expect(() => decryptToken(parseEncryptionKey(key), rows[0].user_id, 'access', bRow.access_token_enc)).toThrow();
    } finally { db.close(); await fake.close(); }
  }, 30000);
  it('rejects malformed upstream data and never exposes upstream errors', async () => {
    let logs = '';
    const stream = new Writable({ write(chunk, _encoding, done) { logs += chunk.toString(); done(); } });
    let mode = 'missing';
    const fetchFake: typeof fetch = async () => {
      if (mode === 'error') return new Response('private-upstream-detail', { status: 400 });
      if (mode === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://example.invalid/' } });
      if (mode === 'oversized') return new Response('x'.repeat(32769), { status: 200 });
      return Response.json({ access_token: 'fake-access-token', expires_in: 3600 });
    };
    const app = await buildApp({ databasePath: ':memory:', loggerStream: stream, jiraOAuth: { clientId: 'mock-client-id', clientSecret: 'mock-client-secret', redirectUri: callback, encryptionKey: key, fetch: fetchFake } }); apps.push(app);
    const { a } = await createTwoUsers(app);
    const start = () => app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } });
    for (const nextMode of ['missing', 'error', 'redirect', 'oversized']) {
      mode = nextMode;
      const authorization = new URL((await start()).json().authorizationUrl);
      const state = authorization.searchParams.get('state');
      const url = `/api/jira/callback?code=fake-code&state=${state}`;
      const result = await app.inject({ url, headers: { cookie: a.cookie } });
      expect(result.statusCode).toBe(303);
      expect(result.body).not.toContain('private-upstream-detail');
      expect(result.body).not.toContain('fake-access-token');
      expect((await app.inject({ url, headers: { cookie: a.cookie } })).headers.location).toBe('/?jira=failed');
    }
    expect(logs).not.toContain('private-upstream-detail');
    expect(logs).not.toContain('fake-access-token');
    expect(logs).not.toContain('mock-client-secret');
  }, 30000);
  it('does not persist credentials after the initiating session logs out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'identityhub-oauth-')); dirs.push(dir);
    const path = join(dir, 'test.db');
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetchFake: typeof fetch = async () => { entered(); await gate; return Response.json({ access_token: 'fake-access-token', refresh_token: 'fake-refresh-token', expires_in: 3600 }); };
    const app = await buildApp({ databasePath: path, jiraOAuth: { clientId: 'mock-client-id', clientSecret: 'mock-client-secret', redirectUri: callback, encryptionKey: key, fetch: fetchFake } }); apps.push(app);
    const { a } = await createTwoUsers(app);
    const start = await app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } });
    const state = new URL(start.json().authorizationUrl).searchParams.get('state');
    const pending = app.inject({ url: `/api/jira/callback?code=fake-code&state=${state}`, headers: { cookie: a.cookie } });
    await waiting;
    const secondLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: a.credentials });
    const secondCookie = sessionCookie(secondLogin.headers['set-cookie']);
    const secondStart = await app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: secondCookie, 'x-csrf-token': secondLogin.json().csrfToken } });
    const secondState = new URL(secondStart.json().authorizationUrl).searchParams.get('state');
    expect((await app.inject({ url: `/api/jira/callback?code=fake-code&state=${secondState}`, headers: { cookie: secondCookie } })).statusCode).toBe(303);
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } })).statusCode).toBe(204);
    release();
    expect((await pending).headers.location).toBe('/?jira=expired');
    const db = new Database(path, { readonly: true });
    try { expect(db.prepare('SELECT COUNT(*) AS count FROM jira_credentials').get()).toEqual({ count: 0 }); } finally { db.close(); }
  }, 30000);
  it('bounds a stalled token exchange', async () => {
    const fetchFake: typeof fetch = async () => new Promise<Response>(() => {});
    const app = await buildApp({ databasePath: ':memory:', jiraOAuth: { clientId: 'mock-client-id', clientSecret: 'mock-client-secret', redirectUri: callback, encryptionKey: key, fetch: fetchFake } }); apps.push(app);
    const { a } = await createTwoUsers(app);
    const start = await app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } });
    const state = new URL(start.json().authorizationUrl).searchParams.get('state');
    const result = await app.inject({ url: `/api/jira/callback?code=fake-code&state=${state}`, headers: { cookie: a.cookie } });
    expect(result.statusCode).toBe(303);
  }, 30000);
});
