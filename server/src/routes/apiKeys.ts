import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SESSION_COOKIE } from "./auth.js";
import type { AuthService } from "../services/auth.js";
import { ApiKeyError, type ApiKeyService } from "../services/apiKeys.js";

const project = z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/);
const createInput = z.object({ name: z.string().trim().min(1).max(80), siteId: z.string().regex(/^[A-Za-z0-9-]{1,128}$/), projects: z.array(project).min(1).max(20).refine(items => new Set(items).size === items.length) }).strict();
const idSchema = z.uuid();

export async function apiKeyRoutes(app: FastifyInstance, auth: AuthService, keys: ApiKeyService) {
  app.get("/api/keys", async (request, reply) => {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: "Not signed in" });
    return { keys: keys.list(session.id) };
  });
  app.post("/api/keys", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: "Not signed in" });
    const parsed = createInput.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "Enter a name and select available projects." });
    try {
      const result = await keys.create(session, parsed.data);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof ApiKeyError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });
  app.delete("/api/keys/:id", async (request, reply) => {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: "Not signed in" });
    const parsed = z.object({ id: idSchema }).safeParse(request.params);
    if (!parsed.success || !keys.revoke(session.id, parsed.data.id)) return reply.code(404).send({ error: "API key not found" });
    return reply.code(204).send();
  });
}
