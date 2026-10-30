import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthService } from "../services/auth.js";

const credentials = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(256),
});
const loginCredentials = credentials.extend({
  password: z.string().min(1).max(256),
});
export const SESSION_COOKIE = "identityhub_session";
const rateLimit = {
  config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
};

function registrationError(field: PropertyKey | undefined) {
  if (field === "email") return "Enter a valid email address.";
  if (field === "password") return "Password must be 12 to 256 characters.";
  return "Provide an email address and password.";
}

export async function authRoutes(
  app: FastifyInstance,
  auth: AuthService,
  secure: boolean,
) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 86400,
  };

  async function register(request: FastifyRequest, reply: FastifyReply) {
    const input = credentials.safeParse(request.body);
    if (!input.success)
      return reply
        .code(422)
        .send({ error: registrationError(input.error.issues[0]?.path[0]) });
    if (!(await auth.register(input.data.email, input.data.password))) {
      return reply
        .code(409)
        .send({ error: "This email is already registered. Please sign in." });
    }
    return reply.code(201).send({ message: "Registered" });
  }

  async function login(request: FastifyRequest, reply: FastifyReply) {
    const input = loginCredentials.safeParse(request.body);
    if (!input.success)
      return reply.code(401).send({ error: "Invalid email or password" });
    const result = await auth.login(
      input.data.email,
      input.data.password,
      request.cookies[SESSION_COOKIE],
    );
    if (!result)
      return reply.code(401).send({ error: "Invalid email or password" });
    reply.setCookie(SESSION_COOKIE, result.token, cookieOptions);
    return { user: result.user, csrfToken: result.csrfToken };
  }

  async function currentSession(request: FastifyRequest, reply: FastifyReply) {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: "Not signed in" });
    return {
      user: { id: session.id, email: session.email },
      csrfToken: session.csrf_token,
    };
  }

  async function logout(request: FastifyRequest, reply: FastifyReply) {
    const session = auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: "Not signed in" });
    auth.logout(session);
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.code(204).send();
  }

  app.post("/api/auth/register", rateLimit, register);
  app.post("/api/auth/login", rateLimit, login);
  app.get("/api/auth/session", currentSession);
  app.post("/api/auth/logout", logout);
}
