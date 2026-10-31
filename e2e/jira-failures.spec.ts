import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Account created");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
}

for (const scenario of ["missing", "invalid"] as const) {
  test(`@jira-${scenario} ${scenario} Jira configuration fails closed in the browser and API`, async ({
    page,
  }) => {
    await signIn(page, `${scenario}-config@example.test`);
    await expect(
      page.getByText(
        "Jira connection is not configured yet. Complete the Jira setup to connect.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Jira" })).toBeDisabled();
    await page.getByText("Jira setup instructions").click();
    await expect(page.getByText(/ATLASSIAN_CLIENT_ID/)).toBeVisible();
    await expect(page.getByText(/ENCRYPTION_KEY/)).toBeVisible();
    const sessionResponse = await page.request.get("/api/auth/session");
    expect(sessionResponse.ok()).toBeTruthy();
    const { csrfToken } = await sessionResponse.json();
    const status = await page.request.get("/api/jira/status");
    expect(await status.json()).toEqual({
      configured: false,
      connected: false,
      site: null,
    });
    const connect = await page.request.post("/api/jira/connect", {
      headers: { "x-csrf-token": csrfToken },
    });
    expect(connect.status()).toBe(503);
    expect(await connect.json()).toEqual({
      error: "Jira connection is not configured",
    });
  });
}

test("@jira-exchange a failed fake OAuth exchange returns safely and stays disconnected", async ({
  page,
}) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(process.env.E2E_BASE_URL!).origin)
      return route.continue();
    if (
      url.origin === "https://auth.atlassian.com" &&
      url.pathname === "/authorize"
    ) {
      const callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.searchParams.set("code", "fake-code");
      callback.searchParams.set("state", url.searchParams.get("state")!);
      return route.fulfill({
        status: 302,
        headers: { location: callback.toString() },
      });
    }
    return route.abort();
  });
  await signIn(page, "exchange-failure@example.test");
  const callback = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/jira/callback",
  );
  await page.getByRole("button", { name: "Connect Jira" }).click();
  const callbackResponse = await callback;
  expect(callbackResponse.status()).toBe(303);
  expect(callbackResponse.headers().location).toBe("/?jira=failed");
  expect(process.env.E2E_FAKE_REQUEST_LOG).toBeTruthy();
  const exchanges = await readFile(process.env.E2E_FAKE_REQUEST_LOG!, "utf8");
  expect(exchanges.trim().split("\n")).toEqual(["token_exchange"]);
  await expect(
    page.getByText(
      "Jira authorization was not completed. Try connecting again.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Not connected to Jira.")).toBeVisible();
  await expect(page.getByText("fake-private-provider-error")).toHaveCount(0);
  const status = await page.request.get("/api/jira/status");
  expect(await status.json()).toEqual({
    configured: true,
    connected: false,
    site: null,
  });
  await expect(
    page.getByRole("button", { name: "Connect Jira" }),
  ).toBeEnabled();
});
