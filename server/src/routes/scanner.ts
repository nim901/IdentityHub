import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FindingError, type FindingsService } from "../jira/findings.js";
import type { ApiKeyService } from "../services/apiKeys.js";

const input = z.object({
  project: z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/),
  title: z.string().trim().min(1).max(255),
  description: z.string().min(1).max(20000),
  type: z.string().trim().min(1).max(128).optional(),
  severity: z.string().trim().min(1).max(128).optional(),
  resource: z.string().trim().min(1).max(512).optional(),
}).strict();

export async function scannerRoutes(app: FastifyInstance, keys: ApiKeyService, findings?: FindingsService) {
  app.post("/api/v1/findings", { bodyLimit: 65536, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const key = keys.authenticate(request.headers["x-api-key"]);
    if (!key) return reply.code(401).send({ error: "Invalid API key" });
    const parsed = input.safeParse(request.body);
    const idempotency = z.string().regex(/^[A-Za-z0-9._~-]{16,128}$/).optional().safeParse(request.headers["idempotency-key"]);
    if (!parsed.success || !idempotency.success) {
      const fields: Record<string, string> = {};
      if (!parsed.success) for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "body")] = "Invalid value";
      if (!idempotency.success) fields["Idempotency-Key"] = "Must contain 16 to 128 permitted characters";
      return reply.code(422).send({ error: "Invalid finding", fields });
    }
    const projectIndex = key.projects.indexOf(parsed.data.project);
    if (projectIndex < 0) return reply.code(403).send({ error: "Project is not permitted." });
    if (!findings) return reply.code(503).send({ error: "Jira connection is not configured" });
    const { project, title, description, type, severity, resource } = parsed.data;
    const extra = [["Type", type], ["Severity", severity], ["Resource", resource]].filter(([, value]) => value !== undefined).map(([label, value]) => `${label}: ${value}`);
    const fullDescription = extra.length ? `${description}\n\n${extra.join("\n")}` : description;
    const operation = `scanner:${key.id}:${idempotency.data ?? randomUUID()}`;
    try {
      const requestIdentity = JSON.stringify([project, title, description, type ?? null, severity ?? null, resource ?? null]);
      const result = await findings.create({ kind: "apiKey", userId: key.userId, siteId: key.siteId, projectId: key.projectIds[projectIndex], requestIdentity, active: () => keys.active(key.userId, key.id) }, { project, title, description: fullDescription }, operation);
      return reply.header("Location", result.url).code(result.replay ? 200 : 201).send({ issueKey: result.issueKey, url: result.url });
    } catch (error) {
      if (error instanceof FindingError) {
        if (error.status === 429) reply.header("Retry-After", "60");
        return reply.code(error.status).send({ error: error.message, ...(error.issueKey ? { issueKey: error.issueKey } : {}) });
      }
      return reply.code(502).send({ error: "Could not create the Jira issue." });
    }
  });
}
