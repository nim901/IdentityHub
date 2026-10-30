import Fastify from 'fastify';

// Jira Cloud 3LO shapes: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
export function createFakeAtlassian(callback: string) {
  const url = new URL(callback);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.hash || url.search) {
    throw new Error('Fake callback must be a local HTTP URL without credentials, query or fragment');
  }
  const app = Fastify({ logger: false, bodyLimit: 4096 });
  app.get('/authorize', async (request, reply) => {
    const q = request.query as Record<string, unknown>;
    if (q.audience !== 'api.atlassian.com' || q.client_id !== 'mock-client-id' || q.redirect_uri !== callback || q.response_type !== 'code' || q.prompt !== 'consent' || typeof q.scope !== 'string' || !q.scope || typeof q.state !== 'string' || !q.state || q.state.length > 512) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const destination = new URL(callback);
    destination.searchParams.set('code', 'fake-code');
    destination.searchParams.set('state', q.state);
    return reply.redirect(destination.toString());
  });
  app.post('/oauth/token', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || body.grant_type !== 'authorization_code' || body.client_id !== 'mock-client-id' || body.client_secret !== 'mock-client-secret' || body.code !== 'fake-code' || body.redirect_uri !== callback) {
      return reply.code(400).send({ error: 'invalid_grant' });
    }
    return { access_token: 'fake-access-token', refresh_token: 'fake-refresh-token', token_type: 'Bearer', expires_in: 3600, scope: 'read:jira-work offline_access' };
  });
  app.get('/oauth/token/accessible-resources', async (request, reply) => {
    if (request.headers.authorization !== 'Bearer fake-access-token') return reply.code(401).send({ error: 'invalid_token' });
    return [{ id: 'fake-cloud-id', name: 'Fake Jira', url: 'https://fake.example.invalid', scopes: ['read:jira-work'], avatarUrl: 'https://fake.example.invalid/avatar.png' }];
  });
  return app;
}
