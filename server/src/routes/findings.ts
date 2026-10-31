import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../services/auth.js';
import { FindingError, type FindingsService } from '../jira/findings.js';
import { SESSION_COOKIE } from './auth.js';

const project = z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/);
const input = z.object({ project, title: z.string().trim().min(1).max(255), description: z.string().min(1).max(20000) }).strict();

export async function findingsRoutes(app: FastifyInstance, auth: AuthService, findings?: FindingsService) {
  app.get('/api/findings', async (request, reply) => {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: 'Not signed in' });
    const query = z.object({ project }).strict().safeParse(request.query);
    if (!query.success) return reply.code(422).send({ error: 'Select a valid project' });
    if (!findings) return reply.code(503).send({ error: 'Jira connection is not configured' });
    return { findings: findings.recent(session.id, query.data.project) };
  });
  app.post('/api/findings', async (request, reply) => {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: 'Not signed in' });
    const parsed = input.safeParse(request.body);
    const key = z.string().regex(/^[A-Za-z0-9._~-]{16,128}$/).safeParse(request.headers['idempotency-key']);
    if (!parsed.success || !key.success) return reply.code(422).send({ error: 'Invalid finding or idempotency key' });
    if (!findings) return reply.code(503).send({ error: 'Jira connection is not configured' });
    try {
      const result = await findings.create(session, parsed.data, key.data);
      if (auth.session(request.cookies[SESSION_COOKIE])?.id_hash !== session.id_hash) return reply.code(401).send({ error: 'Not signed in' });
      return reply.header('Location', result.url).code(result.replay ? 200 : 201).send({ issueKey: result.issueKey, url: result.url });
    } catch (error) {
      if (auth.session(request.cookies[SESSION_COOKIE])?.id_hash !== session.id_hash) return reply.code(401).send({ error: 'Not signed in' });
      if (error instanceof FindingError) return reply.code(error.status).send({ error: error.message, ...(error.issueKey ? { issueKey: error.issueKey } : {}) });
      return reply.code(502).send({ error: 'Could not create the Jira issue.' });
    }
  });
}
