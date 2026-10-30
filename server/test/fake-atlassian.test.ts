import { afterAll, describe, expect, it } from 'vitest';
import { createFakeAtlassian } from '../src/fake-atlassian/service.js';

const callback = 'http://localhost:3000/api/jira/callback';
const app = createFakeAtlassian(callback);
afterAll(() => app.close());
const query = new URLSearchParams({ audience: 'api.atlassian.com', client_id: 'mock-client-id', scope: 'read:jira-work', redirect_uri: callback, state: 'state-123', response_type: 'code', prompt: 'consent' });
const tokenBody = { grant_type: 'authorization_code', client_id: 'mock-client-id', client_secret: 'mock-client-secret', code: 'fake-code', redirect_uri: callback };

describe('fake Atlassian connection', () => {
  it('redirects to the configured callback with code and unchanged state', async () => {
    const response = await app.inject({ method: 'GET', url: `/authorize?${query}` });
    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location!);
    expect(location.origin + location.pathname).toBe(callback);
    expect(location.searchParams.get('code')).toBe('fake-code');
    expect(location.searchParams.get('state')).toBe('state-123');
  });
  it('exchanges the fake code and returns the accessible resource', async () => {
    const token = await app.inject({ method: 'POST', url: '/oauth/token', payload: tokenBody });
    expect(token.statusCode).toBe(200);
    expect(token.json().access_token).toBe('fake-access-token');
    const resources = await app.inject({ method: 'GET', url: '/oauth/token/accessible-resources', headers: { authorization: `Bearer ${token.json().access_token}` } });
    expect(resources.statusCode).toBe(200);
    expect(resources.json()[0]).toMatchObject({ id: 'fake-cloud-id', name: 'Fake Jira' });
  });
  it('rejects invalid authorization, token requests, and unknown endpoints', async () => {
    const bad = new URLSearchParams(query); bad.set('redirect_uri', 'https://example.com');
    expect((await app.inject({ method: 'GET', url: `/authorize?${bad}` })).statusCode).toBe(400);
    bad.set('redirect_uri', callback); bad.set('client_id', 'wrong');
    expect((await app.inject({ method: 'GET', url: `/authorize?${bad}` })).statusCode).toBe(400);
    for (const body of [{ ...tokenBody, code: 'wrong' }, { ...tokenBody, client_secret: 'wrong' }, { ...tokenBody, grant_type: 'refresh_token' }]) {
      expect((await app.inject({ method: 'POST', url: '/oauth/token', payload: body })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url: '/oauth/token/accessible-resources', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/unknown' })).statusCode).toBe(404);
  });
  it('rejects non-loopback callback configuration', () => {
    expect(() => createFakeAtlassian('https://example.com/callback')).toThrow();
  });
});
