import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { JiraOAuth } from '../jira/oauth.js';
import { JiraConnection } from '../jira/connection.js';
import type { AuthService } from '../services/auth.js';
import { SESSION_COOKIE } from './auth.js';

const querySchema = z.object({
  state: z.string().min(1).max(128),
  code: z.string().min(1).max(2048).optional(),
  error: z.string().min(1).max(128).optional(),
}).refine(q => Boolean(q.code) !== Boolean(q.error));

export async function jiraRoutes(app: FastifyInstance, auth: AuthService, oauth?: JiraOAuth, connection?: JiraConnection) {
  app.get('/api/jira/status', async (request, reply) => {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: 'Not signed in' });
    return connection?.status(session.id) ?? { configured: false, connected: false, site: null };
  });
  app.post('/api/jira/connect', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: 'Not signed in' });
    if (!oauth) return reply.code(503).send({ error: 'Jira connection is not configured' });
    return { authorizationUrl: oauth.start(session) };
  });
  app.get('/api/jira/callback', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.redirect('/?jira=expired', 303);
    const input = querySchema.safeParse(request.query);
    if (!oauth || !input.success || !oauth.consume(session, input.data.state)) {
      return reply.redirect('/?jira=failed', 303);
    }
    if (input.data.error) return reply.redirect('/?jira=failed', 303);
    try {
      if (!await oauth.exchangeAndStore(session, input.data.code!)) return reply.redirect('/?jira=expired', 303);
    } catch {
      return reply.redirect('/?jira=failed', 303);
    }
    return reply.redirect('/?jira=connected', 303);
  });
  app.get('/api/jira/sites', async (request, reply) => {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: 'Not signed in' });
    if (!connection) return reply.code(503).send({ error: 'Jira connection is not configured' });
    try {
      const sites = await connection.sites(session.id);
      if (auth.session(request.cookies[SESSION_COOKIE])?.id_hash !== session.id_hash) return reply.code(401).send({ error: 'Not signed in' });
      return { sites };
    } catch { return reply.code(502).send({ error: 'Could not load Jira sites. Reconnect if access has expired.' }); }
  });
  app.post('/api/jira/site', async (request, reply) => {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: 'Not signed in' });
    if (!connection) return reply.code(503).send({ error: 'Jira connection is not configured' });
    const input = z.object({ id: z.string().regex(/^[A-Za-z0-9-]{1,128}$/) }).strict().safeParse(request.body);
    if (!input.success) return reply.code(422).send({ error: 'Select a valid Jira site' });
    try {
      if (!await connection.select(session, input.data.id)) return reply.code(403).send({ error: 'Jira site is not available' });
      return { message: 'Jira site selected' };
    } catch { return reply.code(502).send({ error: 'Could not select Jira site' }); }
  });
  app.get('/api/jira/projects', async (request, reply) => {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: 'Not signed in' });
    if (!connection) return reply.code(503).send({ error: 'Jira connection is not configured' });
    try {
      const projects = await connection.projects(session.id);
      if (auth.session(request.cookies[SESSION_COOKIE])?.id_hash !== session.id_hash) return reply.code(401).send({ error: 'Not signed in' });
      return { projects };
    } catch { return reply.code(502).send({ error: 'Could not load Jira projects. Select a site or reconnect.' }); }
  });
}
