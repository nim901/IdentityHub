import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { JiraOAuth } from '../jira/oauth.js';
import type { AuthService } from '../services/auth.js';
import { SESSION_COOKIE } from './auth.js';

const querySchema = z.object({
  state: z.string().min(1).max(128),
  code: z.string().min(1).max(2048).optional(),
  error: z.string().min(1).max(128).optional(),
}).refine(q => Boolean(q.code) !== Boolean(q.error));

export async function jiraRoutes(app: FastifyInstance, auth: AuthService, oauth?: JiraOAuth) {
  app.post('/api/jira/connect', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: 'Not signed in' });
    if (!oauth) return reply.code(503).send({ error: 'Jira connection is not configured' });
    return { authorizationUrl: oauth.start(session) };
  });
  app.get('/api/jira/callback', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: 'Not signed in' });
    const input = querySchema.safeParse(request.query);
    if (!oauth || !input.success || !oauth.consume(session, input.data.state)) {
      return reply.code(400).send({ error: 'Invalid or expired connection request' });
    }
    if (input.data.error) return reply.code(400).send({ error: 'Jira authorization was not completed' });
    try {
      if (!await oauth.exchangeAndStore(session, input.data.code!)) return reply.code(401).send({ error: 'Not signed in' });
    } catch {
      return reply.code(502).send({ error: 'Jira authorization could not be completed. Start again.' });
    }
    return { message: 'Jira credentials saved. Project discovery is not available yet.' };
  });
}
