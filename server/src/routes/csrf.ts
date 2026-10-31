import type { FastifyReply, FastifyRequest } from "fastify";
import { SESSION_COOKIE } from "./auth.js";
import { AuthService } from "../services/auth.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function csrfGuard(auth: AuthService) {
  return async function checkCsrf(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    // When a Jira or finding read carries a session token, bind its response to that
    // session even if the shared browser cookie changed between requests.
    const boundUserRead = request.method === "GET" &&
      (request.routeOptions.url?.startsWith("/api/jira/") || request.routeOptions.url === "/api/findings" || request.routeOptions.url?.startsWith("/api/keys")) &&
      request.headers["x-csrf-token"] !== undefined;
    if (!WRITE_METHODS.has(request.method) && !boundUserRead) return;
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return;
    const header = request.headers["x-csrf-token"];
    const token = typeof header === "string" ? header : undefined;
    if (!auth.validCsrf(session, token)) {
      return reply.code(403).send({ error: "Invalid CSRF token" });
    }
  };
}
