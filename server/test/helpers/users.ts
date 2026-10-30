import type { FastifyInstance } from "fastify";

export const userA = { email: "alice@example.test", password: "test-password-123" };
export const userB = { email: "bob@example.test", password: "test-password-456" };

export function sessionCookie(header: string | string[] | undefined) {
  return String(header).split(";")[0];
}

export async function createTwoUsers(app: FastifyInstance) {
  const sessions = [];
  for (const credentials of [userA, userB]) {
    const registration = await app.inject({ method: "POST", url: "/api/auth/register", payload: credentials });
    if (registration.statusCode !== 201) throw new Error("Failed to create test user");
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: credentials });
    if (login.statusCode !== 200) throw new Error("Failed to sign in test user");
    sessions.push({ credentials, cookie: sessionCookie(login.headers["set-cookie"]), csrfToken: login.json().csrfToken as string });
  }
  return { a: sessions[0], b: sessions[1] };
}
