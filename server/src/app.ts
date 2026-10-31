import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Writable } from "node:stream";
import { openDatabase } from "./db/database.js";
import { AuthService } from "./services/auth.js";
import { authRoutes } from "./routes/auth.js";
import { csrfGuard } from "./routes/csrf.js";
import { JiraOAuth, type JiraOAuthConfig } from "./jira/oauth.js";
import { jiraRoutes } from "./routes/jira.js";
import { JiraConnection } from "./jira/connection.js";

export async function buildApp(
  options: {
    databasePath?: string;
    secureCookies?: boolean;
    jiraOAuth?: JiraOAuthConfig;
    loggerStream?: Writable;
  } = {},
) {
  const app = Fastify({
    logger: {
      stream: options.loggerStream,
      serializers: {
        req(req) {
          return { method: req.method, url: req.url?.split('?')[0], host: req.hostname, remoteAddress: req.ip };
        },
      },
    },
    bodyLimit: 1024 * 1024,
  });
  const db = openDatabase(
    options.databasePath ?? process.env.DATABASE_PATH ?? "app.db",
  );
  app.addHook("onClose", async () => {
    db.close();
  });
  await app.register(cookie);
  await app.register(helmet);
  app.addHook("onRequest", async (request, reply) => {
    if (request.routeOptions.url?.startsWith("/api/auth/") || request.routeOptions.url?.startsWith("/api/jira/")) {
      reply.header("Cache-Control", "no-store");
      reply.header("Referrer-Policy", "no-referrer");
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
  // Test transports are injected explicitly; never silently ignore a configured fake URL.
  const supportedAuthBases = (!process.env.ATLASSIAN_AUTH_BASE || process.env.ATLASSIAN_AUTH_BASE === 'https://auth.atlassian.com') &&
    (!process.env.ATLASSIAN_AUTH_BROWSER_BASE || process.env.ATLASSIAN_AUTH_BROWSER_BASE === 'https://auth.atlassian.com');
  const oauthConfig = options.jiraOAuth ?? (
    supportedAuthBases && process.env.ATLASSIAN_CLIENT_ID && process.env.ATLASSIAN_CLIENT_SECRET && process.env.OAUTH_REDIRECT_URI && process.env.ENCRYPTION_KEY
      ? { clientId: process.env.ATLASSIAN_CLIENT_ID, clientSecret: process.env.ATLASSIAN_CLIENT_SECRET, redirectUri: process.env.OAUTH_REDIRECT_URI, encryptionKey: process.env.ENCRYPTION_KEY }
      : undefined
  );
  let oauth: JiraOAuth | undefined;
  if (oauthConfig) {
    try { oauth = new JiraOAuth(db, oauthConfig); } catch { /* Invalid configuration disables the connection. */ }
  }
  const connection = oauth ? new JiraConnection(db, oauth) : undefined;
  await app.register(async (instance) => jiraRoutes(instance, auth, oauth, connection));
  app.get("/healthz", async () => ({ status: "ok" }));
  const webRoot = resolve(
    fileURLToPath(new URL("../../web/dist", import.meta.url)),
  );
  if (existsSync(webRoot)) await app.register(fastifyStatic, { root: webRoot });
  return app;
}
