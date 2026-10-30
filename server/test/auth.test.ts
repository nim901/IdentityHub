import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createTwoUsers } from "./helpers/users.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
async function setup(secure = false) {
  const app = await buildApp({
    databasePath: ":memory:",
    secureCookies: secure,
  });
  apps.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const credentials = {
  email: "alice@example.test",
  password: "test-password-123",
};
const cookie = (header: string | string[] | undefined) =>
  String(header).split(";")[0];

describe("authentication", () => {
  it("prevents caching of authentication responses", async () => {
    const app = await setup();
    await app.inject({ method: "POST", url: "/api/auth/register", payload: credentials });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: credentials });
    const session = await app.inject({ url: "/api/auth/session", headers: { cookie: cookie(login.headers["set-cookie"]) } });
    const missing = await app.inject({ url: "/api/auth/session" });
    expect(login.headers["cache-control"]).toBe("no-store");
    expect(session.headers["cache-control"]).toBe("no-store");
    expect(missing.headers["cache-control"]).toBe("no-store");
  });
  it("registers, logs in with a new protected session, and logs out with CSRF", async () => {
    const app = await setup(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: credentials,
        })
      ).statusCode,
    ).toBe(201);
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: credentials,
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["set-cookie"]).toMatch(/HttpOnly/i);
    expect(first.headers["set-cookie"]).toMatch(/SameSite=Lax/i);
    expect(first.headers["set-cookie"]).toMatch(/Secure/i);
    const oldCookie = cookie(first.headers["set-cookie"]);
    const second = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { cookie: oldCookie, "x-csrf-token": first.json().csrfToken },
      payload: credentials,
    });
    expect(cookie(second.headers["set-cookie"])).not.toBe(oldCookie);
    expect(
      (
        await app.inject({
          url: "/api/auth/session",
          headers: { cookie: oldCookie },
        })
      ).statusCode,
    ).toBe(401);
    const sessionCookie = cookie(second.headers["set-cookie"]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { cookie: sessionCookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: {
            cookie: sessionCookie,
            "x-csrf-token": second.json().csrfToken,
          },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          url: "/api/auth/session",
          headers: { cookie: sessionCookie },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("sets security headers and omits Secure on local HTTP", async () => {
    const app = await setup();
    const health = await app.inject({ url: "/healthz" });
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    expect(health.headers["content-security-policy"]).toBeDefined();
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: credentials,
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: credentials,
    });
    expect(String(login.headers["set-cookie"])).not.toMatch(/; Secure/i);
  });
  it("rejects wrong credentials generically and rate limits login", async () => {
    const app = await setup();
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: credentials,
    });
    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { ...credentials, password: "wrong-password" },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { ...credentials, email: "missing@example.test" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    let result = wrong;
    for (let i = 0; i < 12; i++) {
      result = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {},
      });
    }
    expect(result.statusCode).toBe(429);
    expect(result.headers["cache-control"]).toBe("no-store");
  });
  it("returns only the user associated with each session", async () => {
    const app = await setup();
    const { a, b } = await createTwoUsers(app);
    const aSession = await app.inject({ url: "/api/auth/session", headers: { cookie: a.cookie } });
    const bSession = await app.inject({ url: "/api/auth/session", headers: { cookie: b.cookie } });
    expect(aSession.json().user.email).toBe(a.credentials.email);
    expect(bSession.json().user.email).toBe(b.credentials.email);
    expect(aSession.json().user.id).not.toBe(bSession.json().user.id);
    const crossUser = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: a.cookie, "x-csrf-token": b.csrfToken } });
    expect(crossUser.statusCode).toBe(403);
    expect((await app.inject({ url: "/api/auth/session", headers: { cookie: a.cookie } })).statusCode).toBe(200);
  });

});

it("rejects invalid registration with a useful message", async () => {
  const app = await setup();
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "invalid", password: "example-password-123" },
  });
  expect(response.statusCode).toBe(422);
  expect(response.json().error).toContain("valid email");
});
