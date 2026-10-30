import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

afterEach(() => vi.useRealTimers());
describe("session expiry", () => {
  it("rejects an expired session", async () => {
    const app = await buildApp({ databasePath: ":memory:" });
    const payload = {
      email: "expiry@example.test",
      password: "test-password-123",
    };
    await app.inject({ method: "POST", url: "/api/auth/register", payload });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload,
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    const result = await app.inject({
      url: "/api/auth/session",
      headers: { cookie },
    });
    expect(result.statusCode).toBe(401);
    vi.useRealTimers();
    await app.close();
  });
});
