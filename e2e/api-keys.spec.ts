import { expect, test } from "@playwright/test";

test("@keys manages a restricted API key and shows its secret only once", async ({ page }, testInfo) => {
  await page.route("https://auth.atlassian.com/**", async route => {
    const url = new URL(route.request().url());
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "fake-code");
    callback.searchParams.set("state", url.searchParams.get("state")!);
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("keys-e2e@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Account created");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await page.getByLabel("Jira site").selectOption("site-one");
  await page.getByRole("button", { name: "Save site" }).click();
  await expect(page.getByText("Site selected.")).toBeVisible();
  await page.getByRole("tab", { name: "API access" }).click();
  await page.getByLabel("Key name").fill("Build scanner");
  await page.getByLabel("Allow ONE").check();
  await page.getByRole("button", { name: "Generate API key" }).click();
  await expect(page.getByText("Copy this key now")).toBeVisible();
  await expect(page.getByLabel("New API key")).toHaveValue(/^ih_[A-Za-z0-9_-]{43}$/);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByLabel("New API key")).toHaveCount(0);
  await expect(page.getByText("Build scanner")).toBeVisible();
  await page.getByRole("button", { name: /^Revoke Build scanner/ }).click();
  await page.getByRole("button", { name: "Confirm revoke" }).click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: testInfo.outputPath("api-keys-mobile.png"), fullPage: true });
  await page.getByLabel("Key name").fill("Unseen key");
  await page.getByLabel("Allow ONE").check();
  await page.route("**/api/keys", route => route.fulfill({ status: 403, json: { error: "One or more projects are not available." } }), { times: 1 });
  await page.getByRole("button", { name: "Generate API key" }).click();
  await expect(page.getByRole("alert")).toContainText("Key was not created");
  await expect(page.getByLabel("Key name")).toHaveValue("Unseen key");
  await page.route("**/api/keys", route => route.fulfill({ status: 401, body: "temporary intermediary failure" }), { times: 1 });
  await page.getByRole("button", { name: "Generate API key" }).click();
  await expect(page.getByText(/key may have been created/i)).toBeVisible();
  await expect(page.getByLabel("Key name")).toHaveValue("Unseen key");
  await expect(page.getByLabel("New API key")).toHaveCount(0);
  let attempts = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/keys" && request.method() === "POST") attempts++; });
  await page.route("**/api/keys", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.status()).toBe(201);
    await route.abort();
  }, { times: 1 });
  await page.getByRole("button", { name: "Generate API key" }).click();
  await expect(page.getByText(/key may have been created/i)).toBeVisible();
  await expect(page.getByText("Unseen key")).toBeVisible();
  expect(attempts).toBe(1);
  await expect(page.getByLabel("New API key")).toHaveCount(0);
  await page.route("**/api/keys/*", async route => {
    if (route.request().method() !== "DELETE") return route.continue();
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.status()).toBe(204);
    await route.abort();
  }, { times: 1 });
  await page.getByRole("button", { name: /^Revoke Unseen key/ }).click();
  await page.getByRole("button", { name: "Confirm revoke" }).click();
  await expect(page.getByText("Could not confirm revocation. Check the list before trying again.")).toBeVisible();
  await expect(page.getByText("Revoked", { exact: true })).toHaveCount(2);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "API access" }).click();
  await expect(page.getByLabel("New API key")).toHaveCount(0);
  await expect(page.getByText("Revoked", { exact: true })).toHaveCount(2);
  await page.getByRole("tab", { name: "Jira connection" }).click();
  await page.route("**/api/keys", route => route.fulfill({ status: 503 }), { times: 1 });
  await page.getByRole("tab", { name: "API access" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not load API keys");
  await expect(page.getByText("No API keys yet.")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry keys" }).click();
  await expect(page.getByText("Revoked", { exact: true })).toHaveCount(2);
  await page.getByRole("tab", { name: "Jira connection" }).click();
  await page.route("**/api/keys", route => route.fulfill({ json: { keys: [{ id: "legacy-id", name: "Legacy scanner", prefix: "ih_fixture", siteId: "site-one", projects: ["ONE"], createdAt: "2026-01-01T00:00:00.000Z", revokedAt: null, requiresReplacement: true }] } }), { times: 1 });
  await page.getByRole("tab", { name: "API access" }).click();
  await expect(page.getByText("Needs replacement", { exact: true })).toBeVisible();
  await expect(page.getByText("Replace this key before using scanner access.")).toBeVisible();
});

test("@keys switching accounts during key creation does not expose a key or create one for the new user", async ({ page, context }) => {
  await page.route("https://auth.atlassian.com/**", async route => {
    const url = new URL(route.request().url());
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "fake-code");
    callback.searchParams.set("state", url.searchParams.get("state")!);
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
  await page.goto("/");
  for (const email of ["key-owner@example.test", "key-other@example.test"]) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("example-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("status")).toContainText("Account created");
  }
  await page.getByLabel("Email").fill("key-owner@example.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await page.getByLabel("Jira site").selectOption("site-one");
  await page.getByRole("button", { name: "Save site" }).click();
  await expect(page.getByText("Site selected.")).toBeVisible();
  await page.getByRole("tab", { name: "API access" }).click();
  await page.getByLabel("Key name").fill("Private scanner");
  await page.getByLabel("Allow ONE").check();
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/api/keys", async route => {
    if (route.request().method() !== "POST") return route.continue();
    started();
    await blocked;
    await route.continue();
  });
  await page.getByRole("button", { name: "Generate API key" }).click();
  await requestStarted;
  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: /key-owner@example.test/ }).click();
  await other.getByRole("menuitem", { name: "Sign out" }).click();
  await other.getByLabel("Email").fill("key-other@example.test");
  await other.getByLabel("Password").fill("example-password-123");
  await other.getByRole("button", { name: "Sign in" }).click();
  await expect(other.getByRole("button", { name: /key-other@example.test/ })).toBeVisible();
  const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/keys" && response.request().method() === "POST");
  release();
  expect([401, 403]).toContain((await response).status());
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("New API key")).toHaveCount(0);
  await expect(page.getByText("Private scanner")).toHaveCount(0);
  await other.getByRole("button", { name: "Settings", exact: true }).click();
  await other.getByRole("tab", { name: "API access" }).click();
  await expect(other.getByText("No API keys yet.")).toBeVisible();
});

test("@keys keeps the one-time key visible when creation is pending", async ({ page }) => {
  await page.route("https://auth.atlassian.com/**", async route => {
    const url = new URL(route.request().url());
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "fake-code");
    callback.searchParams.set("state", url.searchParams.get("state")!);
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("keys-pending@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Account created");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await page.getByLabel("Jira site").selectOption("site-one");
  await page.getByRole("button", { name: "Save site" }).click();
  await expect(page.getByText("Site selected.")).toBeVisible();
  await page.getByRole("tab", { name: "API access" }).click();
  await page.getByLabel("Key name").fill("Pending scanner");
  await page.getByLabel("Allow ONE").check();
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const startedRequest = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/api/keys", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.status()).toBe(201);
    started();
    await blocked;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "Generate API key" }).click();
    await startedRequest;
    await expect(page.getByRole("tab", { name: "Jira connection" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Findings", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: /keys-pending@example.test/ })).toBeDisabled();
    expect(await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(true);
    release();
    await expect(page.getByLabel("New API key")).toHaveValue(/^ih_[A-Za-z0-9_-]{43}$/);
  } finally { release(); }
});

test("@keys does not expose an already-created key after an account switch", async ({ page, context }) => {
  await page.route("https://auth.atlassian.com/**", async route => {
    const url = new URL(route.request().url());
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "fake-code");
    callback.searchParams.set("state", url.searchParams.get("state")!);
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
  await page.goto("/");
  for (const email of ["key-created-owner@example.test", "key-created-other@example.test"]) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("example-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("status")).toContainText("Account created");
  }
  await page.getByLabel("Email").fill("key-created-owner@example.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await page.getByLabel("Jira site").selectOption("site-one");
  await page.getByRole("button", { name: "Save site" }).click();
  await expect(page.getByText("Site selected.")).toBeVisible();
  await page.getByRole("tab", { name: "API access" }).click();
  await page.getByLabel("Key name").fill("Private completed key");
  await page.getByLabel("Allow ONE").check();
  let release!: () => void;
  let created!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const createdOnServer = new Promise<void>(resolve => { created = resolve; });
  await page.route("**/api/keys", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.status()).toBe(201);
    created();
    await blocked;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "Generate API key" }).click();
    await createdOnServer;
    const other = await context.newPage();
    await other.goto("/");
    await other.getByRole("button", { name: /key-created-owner@example.test/ }).click();
    await other.getByRole("menuitem", { name: "Sign out" }).click();
    await other.getByLabel("Email").fill("key-created-other@example.test");
    await other.getByLabel("Password").fill("example-password-123");
    await other.getByRole("button", { name: "Sign in" }).click();
    await expect(other.getByRole("button", { name: /key-created-other@example.test/ })).toBeVisible();
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("alert")).toContainText("original account");
    release();
    await expect(page.getByLabel("New API key")).toHaveCount(0);
    await expect(page.getByText("Private completed key")).toHaveCount(0);
  } finally { release(); }
});
