import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTwoUsers } from './helpers/users.js';

const callback = 'http://localhost:3000/api/jira/callback';
const key = Buffer.alloc(32, 7).toString('base64');
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

it('discovers and selects an accessible site and lists its projects per user', async () => {
  const requests: string[] = [];
  let blockProjects = false;
  let signalStarted!: () => void;
  let releaseProjects!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const released = new Promise<void>(resolve => { releaseProjects = resolve; });
  const fetchFake: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url.origin + url.pathname);
    expect(init?.redirect).toBe('error');
    if (url.href === 'https://auth.atlassian.com/oauth/token') return Response.json({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600, scope: 'read:jira-work offline_access' });
    if (url.href === 'https://api.atlassian.com/oauth/token/accessible-resources') return Response.json([
      { id: 'site-one', name: 'One', url: 'https://one.atlassian.net', scopes: ['read:jira-work'] },
      { id: 'site-two', name: 'Two', url: 'https://two.atlassian.net', scopes: ['read:jira-work'] },
    ]);
    if (url.origin + url.pathname === 'https://api.atlassian.com/ex/jira/site-one/rest/api/3/project/search') {
      if (blockProjects) { signalStarted(); await released; }
      return Response.json({ startAt: 0, maxResults: 50, total: 1, isLast: true, values: [{ id: '100', key: 'ONE', name: 'One project' }] });
    }
    throw new Error('Unexpected network request');
  };
  const app = await buildApp({ databasePath: ':memory:', jiraOAuth: { clientId: 'mock-client-id', clientSecret: 'mock-client-secret', redirectUri: callback, encryptionKey: key, fetch: fetchFake } }); apps.push(app);
  const { a, b } = await createTwoUsers(app);
  const start = await app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } });
  const state = new URL(start.json().authorizationUrl).searchParams.get('state');
  expect((await app.inject({ url: `/api/jira/callback?code=fake-code&state=${state}`, headers: { cookie: a.cookie } })).statusCode).toBe(303);
  const sites = await app.inject({ url: '/api/jira/sites', headers: { cookie: a.cookie } });
  expect(sites.statusCode).toBe(200);
  expect(sites.json().sites.map((site: { id: string }) => site.id)).toEqual(['site-one', 'site-two']);
  expect((await app.inject({ url: '/api/jira/sites', headers: { cookie: b.cookie } })).statusCode).not.toBe(200);
  expect((await app.inject({ method: 'POST', url: '/api/jira/site', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken }, payload: { id: 'unknown' } })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/jira/site', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken }, payload: { id: 'site-one' } })).statusCode).toBe(200);
  const projects = await app.inject({ url: '/api/jira/projects', headers: { cookie: a.cookie } });
  expect(projects.statusCode).toBe(200);
  expect(projects.json().projects).toEqual([{ id: '100', key: 'ONE', name: 'One project' }]);
  expect((await app.inject({ url: '/api/jira/projects', headers: { cookie: b.cookie } })).statusCode).not.toBe(200);
  expect(JSON.stringify(projects.json())).not.toContain('fake-access');
  expect(requests).toContain('https://api.atlassian.com/ex/jira/site-one/rest/api/3/project/search');
  blockProjects = true;
  const pendingProjects = app.inject({ url: '/api/jira/projects', headers: { cookie: a.cookie } });
  await started;
  expect((await app.inject({ method: 'POST', url: '/api/jira/site', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken }, payload: { id: 'site-two' } })).statusCode).toBe(200);
  releaseProjects();
  expect((await pendingProjects).statusCode).toBe(502);
}, 30000);

it('returns user-scoped connection status without credentials', async () => {
  const app = await buildApp({ databasePath: ':memory:', jiraOAuth: { clientId: 'mock-client-id', clientSecret: 'mock-client-secret', redirectUri: callback, encryptionKey: key, fetch: async (input) => {
    if (String(input) === 'https://auth.atlassian.com/oauth/token') return Response.json({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600 });
    if (String(input) === 'https://api.atlassian.com/oauth/token/accessible-resources') return Response.json([{ id: 'site-one', name: 'One', url: 'https://one.atlassian.net', scopes: ['read:jira-work'] }]);
    throw new Error('Unexpected network request');
  } } }); apps.push(app);
  const { a, b } = await createTwoUsers(app);
  expect((await app.inject({ url: '/api/jira/status' })).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/jira/status', headers: { cookie: b.cookie, 'x-csrf-token': a.csrfToken } })).statusCode).toBe(403);
  expect((await app.inject({ url: '/api/jira/status', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } })).statusCode).toBe(200);
  expect((await app.inject({ url: '/api/jira/status', headers: { cookie: a.cookie } })).json()).toEqual({ configured: true, connected: false, site: null });
  const start = await app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } });
  const state = new URL(start.json().authorizationUrl).searchParams.get('state');
  const callbackResponse = await app.inject({ url: `/api/jira/callback?code=fake-code&state=${state}`, headers: { cookie: a.cookie } });
  expect(callbackResponse.statusCode).toBe(303);
  expect(callbackResponse.headers.location).toBe('/?jira=connected');
  expect((await app.inject({ url: '/api/jira/status', headers: { cookie: a.cookie } })).json()).toEqual({ configured: true, connected: true, site: null });
  await app.inject({ method: 'POST', url: '/api/jira/site', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken }, payload: { id: 'site-one' } });
  const status = await app.inject({ url: '/api/jira/status', headers: { cookie: a.cookie } });
  expect(status.json()).toEqual({ configured: true, connected: true, site: { id: 'site-one', name: 'One', url: 'https://one.atlassian.net' } });
  expect(status.body).not.toContain('fake-access');
  expect((await app.inject({ url: '/api/jira/status', headers: { cookie: b.cookie } })).json()).toEqual({ configured: true, connected: false, site: null });
}, 30000);
