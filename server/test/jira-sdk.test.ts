import { afterAll, expect, it } from 'vitest';
import { exchangeAuthorizationCode, generateAuthorizationUrl, getAccessibleResources, parseCallbackUrl } from 'jira.js';
import { createFakeAtlassian } from '../src/fake-atlassian/service.js';

const callback = 'http://localhost:3000/api/jira/callback';
const fake = createFakeAtlassian(callback);
afterAll(() => fake.close());

// This adapter never performs a network request. Only the two expected SDK URLs are allowed.
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const allowed = (url.origin === 'https://auth.atlassian.com' && url.pathname === '/oauth/token') ||
    (url.origin === 'https://api.atlassian.com' && url.pathname === '/oauth/token/accessible-resources');
  const expectedMethod = url.pathname === '/oauth/token' ? 'POST' : 'GET';
  if (!allowed || url.search || url.hash || (init?.method ?? 'GET') !== expectedMethod) throw new Error('Unexpected SDK destination');
  const response = await fake.inject({
    method: init?.method === 'POST' ? 'POST' : 'GET',
    url: url.pathname,
    headers: Object.fromEntries(new Headers(init?.headers)),
    payload: typeof init?.body === 'string' ? init.body : undefined,
  });
  return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } });
};

it('uses jira.js with the local fake throughout the connection sequence', async () => {
  const auth = new URL(generateAuthorizationUrl({ clientId: 'mock-client-id', redirectUri: callback, state: 'state-123', scopes: ['read:jira-work'] }));
  expect(auth.origin + auth.pathname).toBe('https://auth.atlassian.com/authorize');
  // The test dispatches the SDK-generated path and query directly to the fake.
  const response = await fake.inject({ method: 'GET', url: auth.pathname + auth.search });
  expect(response.statusCode).toBe(302);
  const { code } = parseCallbackUrl(response.headers.location!, { expectedState: 'state-123' });
  const tokens = await exchangeAuthorizationCode({ clientId: 'mock-client-id', clientSecret: 'mock-client-secret', redirectUri: callback, code, fetch: fakeFetch });
  expect(tokens.accessToken).toBe('fake-access-token');
  expect(await getAccessibleResources(tokens.accessToken, fakeFetch)).toMatchObject([{ id: 'fake-cloud-id', name: 'Fake Jira' }]);
});

it('rejects unexpected network destinations in the test adapter', async () => {
  await expect(fakeFetch('https://example.com/oauth/token')).rejects.toThrow('Unexpected SDK destination');
  await expect(fakeFetch('https://auth.atlassian.com/oauth/token', { method: 'GET' })).rejects.toThrow('Unexpected SDK destination');
});
