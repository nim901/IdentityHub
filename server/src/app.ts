import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db/database.js";
import { AuthService } from "./services/auth.js";
import { authRoutes } from "./routes/auth.js";
import { csrfGuard } from "./routes/csrf.js";

export async function buildApp(
  options: { databasePath?: string; secureCookies?: boolean } = {},
) {
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
  const db = openDatabase(
    options.databasePath ?? process.env.DATABASE_PATH ?? "app.db",
  );
  app.addHook("onClose", async () => {
    db.close();
  });
  await app.register(cookie);
  await app.register(helmet);
  app.addHook("onRequest", async (request, reply) => {
    if (request.routeOptions.url?.startsWith("/api/auth/")) {
      reply.header("Cache-Control", "no-store");
    }
  });
  await app.register(rateLimit, { global: false });
  const auth = new AuthService(db);
  app.addHook("preHandler", csrfGuard(auth));
  await app.register(async (instance) =>
    authRoutes(
      instance,
      auth,
      options.secureCookies ??
        process.env.APP_BASE_URL?.startsWith("https://") ??
        false,
    ),
  );
  app.get("/healthz", async () => ({ status: "ok" }));
  const webRoot = resolve(
    fileURLToPath(new URL("../../web/dist", import.meta.url)),
  );
  if (existsSync(webRoot)) await app.register(fastifyStatic, { root: webRoot });
  return app;
}
