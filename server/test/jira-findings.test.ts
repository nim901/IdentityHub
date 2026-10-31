import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTwoUsers } from './helpers/users.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

it('creates a finding safely, prevents duplicate requests and isolates recent tickets', async () => {
  let writes = 0;
  let uncertain = false;
  let unsupportedRequiredField = false;
  let allowWrite = true;
  let malformedMetadata = false;
  const fetchFake: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.href === 'https://auth.atlassian.com/oauth/token') return Response.json({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600 });
    if (url.href === 'https://api.atlassian.com/oauth/token/accessible-resources') return Response.json([{ id: 'site-one', name: 'One', url: 'https://one.atlassian.net', scopes: allowWrite ? ['read:jira-work', 'write:jira-work'] : ['read:jira-work'] }]);
    const path = url.pathname.replace('/ex/jira/site-one', '');
    if (url.origin !== 'https://api.atlassian.com') throw new Error('Unexpected provider');
    if (path === '/rest/api/3/project/search') return Response.json({ startAt: 0, maxResults: 50, total: 1, isLast: true, values: [{ id: '100', key: 'ONE', name: 'Project' }] });
    if (path === '/rest/api/3/issue/createmeta/ONE/issuetypes') return Response.json({ startAt: 0, maxResults: 50, total: 1, issueTypes: [{ id: '1', name: 'Task', subtask: false }] });
    if (path === '/rest/api/3/issue/createmeta/ONE/issuetypes/1') return Response.json({ startAt: 0, maxResults: 50, total: unsupportedRequiredField ? 3 : 2, fields: [
      { fieldId: 'summary', key: 'summary', name: 'Summary', operations: ['set'], required: malformedMetadata ? 'yes' : true },
      { fieldId: 'description', key: 'description', name: 'Description', operations: ['set'], required: false },
      ...(unsupportedRequiredField ? [{ fieldId: 'customfield_123', key: 'customfield_123', name: 'Required', schema: { type: 'string' }, operations: ['set'], required: true }] : []),
    ] });
    if (path === '/rest/api/3/issue' && init?.method === 'POST') {
      writes++;
      const body = JSON.parse(String(init.body));
      expect(body.fields.summary).toBe('Finding');
      expect(body.fields.description).toMatchObject({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>not markup</script>' }] }] });
      if (uncertain) return new Response('fake failure', { status: 503 });
      return Response.json({ id: String(1000 + writes), key: `ONE-${writes}`, self: `https://api.atlassian.com/ex/jira/site-one/rest/api/3/issue/${1000 + writes}` }, { status: 201 });
    }
    throw new Error('Unexpected provider request');
  };
  const app = await buildApp({ databasePath: ':memory:', jiraOAuth: { clientId: 'mock-client-id', clientSecret: 'mock-client-secret', redirectUri: 'http://localhost:3000/api/jira/callback', encryptionKey: Buffer.alloc(32, 7).toString('base64'), fetch: fetchFake } }); apps.push(app);
  const { a, b } = await createTwoUsers(app);
  const start = await app.inject({ method: 'POST', url: '/api/jira/connect', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken } });
  const state = new URL(start.json().authorizationUrl).searchParams.get('state');
  expect((await app.inject({ url: `/api/jira/callback?code=fake-code&state=${state}`, headers: { cookie: a.cookie } })).statusCode).toBe(303);
  expect((await app.inject({ method: 'POST', url: '/api/jira/site', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken }, payload: { id: 'site-one' } })).statusCode).toBe(200);
  const payload = { project: 'ONE', title: 'Finding', description: '<script>not markup</script>' };
  const request = (id: string) => app.inject({ method: 'POST', url: '/api/findings', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken, 'idempotency-key': id }, payload });
  expect((await app.inject({ method: 'POST', url: '/api/findings', headers: { cookie: a.cookie }, payload })).statusCode).toBe(403);
  const result = await request('fake-idempotency-key-1');
  expect(result.statusCode).toBe(201);
  expect(result.json()).toMatchObject({ issueKey: 'ONE-1', url: 'https://one.atlassian.net/browse/ONE-1' });
  expect((await request('fake-idempotency-key-1')).statusCode).toBe(200);
  const conflict = await app.inject({ method: 'POST', url: '/api/findings', headers: { cookie: a.cookie, 'x-csrf-token': a.csrfToken, 'idempotency-key': 'fake-idempotency-key-1' }, payload: { ...payload, title: 'Different' } });
  expect(conflict.statusCode).toBe(409);
  expect(writes).toBe(1);
  const concurrent = await Promise.all([request('fake-idempotency-key-3'), request('fake-idempotency-key-3')]);
  expect(concurrent.map(response => response.statusCode).sort()).toEqual([200, 201]);
  expect(writes).toBe(2);
  const recent = await app.inject({ url: '/api/findings?project=ONE', headers: { cookie: a.cookie } });
  expect(recent.statusCode).toBe(200);
  expect(recent.json().findings).toHaveLength(2);
  expect((await app.inject({ url: '/api/findings?project=ONE', headers: { cookie: b.cookie } })).json().findings).toEqual([]);
  allowWrite = false;
  expect((await request('fake-idempotency-key-5')).statusCode).toBe(403);
  expect(writes).toBe(2);
  allowWrite = true;
  malformedMetadata = true;
  expect((await request('fake-idempotency-key-6')).statusCode).toBe(502);
  expect(writes).toBe(2);
  malformedMetadata = false;
  unsupportedRequiredField = true;
  expect((await request('fake-idempotency-key-4')).statusCode).toBe(422);
  expect(writes).toBe(2);
  unsupportedRequiredField = false;
  uncertain = true;
  expect((await request('fake-idempotency-key-2')).statusCode).toBe(502);
  expect((await request('fake-idempotency-key-2')).statusCode).toBe(409);
  expect(writes).toBe(3);
}, 30000);
