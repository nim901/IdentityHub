import { expect, test } from "@playwright/test";

test("@recent-refresh recent tickets refresh after returning to Findings and via Refresh", async ({ page, request }) => {
  await page.route("https://auth.atlassian.com/**", async route => {
    const url = new URL(route.request().url());
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "fake-code");
    callback.searchParams.set("state", url.searchParams.get("state")!);
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("refresh-e2e@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Account created");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await page.getByLabel("Jira site").selectOption("site-one");
  await page.getByRole("button", { name: "Save site" }).click();
  await expect(page.getByText("Site selected.")).toBeVisible();
  await page.getByRole("button", { name: "Findings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  await page.getByLabel("Jira project").selectOption("ONE");
  await expect(page.getByText("No tickets yet")).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "API access" }).click();
  await page.getByLabel("Key name").fill("Refresh E2E");
  await page.getByLabel("Allow ONE").check();
  await page.getByRole("button", { name: "Generate API key" }).click();
  const key = await page.getByLabel("New API key").inputValue();
  expect(key).toMatch(/^ih_/);
  await page.getByRole("button", { name: "Done" }).click();
  const created = await request.post("/api/v1/findings", {
    data: { project: "ONE", title: "Scanner refresh finding", description: "Fake finding" },
    headers: { "x-api-key": key, "idempotency-key": "e2e-refresh-operation-1" },
  });
  expect(created.status()).toBe(201);

  // Returning to Findings must refresh the list without reselecting the project.
  await page.getByRole("button", { name: "Findings", exact: true }).click();
  await expect(page.getByText("Scanner refresh finding")).toBeVisible();
  await expect(page.getByRole("link", { name: /ONE-1/ })).toHaveAttribute("href", "https://example.atlassian.net/browse/ONE-1");

  // The manual Refresh action picks up tickets created while staying on Findings.
  const second = await request.post("/api/v1/findings", {
    data: { project: "ONE", title: "Second scanner finding", description: "Fake finding" },
    headers: { "x-api-key": key, "idempotency-key": "e2e-refresh-operation-2" },
  });
  expect(second.status()).toBe(201);
  await expect(page.getByText("Second scanner finding")).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Second scanner finding")).toBeVisible();

  // A failed refresh is visible and can be retried.
  await page.route("**/api/findings?*", route => route.fulfill({ status: 503 }), { times: 1 });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not load recent tickets");
  await page.getByRole("button", { name: "Retry tickets" }).click();
  await expect(page.getByText("Second scanner finding")).toBeVisible();

  // A late response must not restore tickets after the project changes.
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/api/findings?*", async route => {
    started();
    await blocked;
    await route.fulfill({ json: { findings: [{ issueKey: "ONE-99", title: "Stale ticket", createdAt: "2026-01-01T00:00:00Z", url: "https://example.atlassian.net/browse/ONE-99" }] } });
  }, { times: 1 });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await requestStarted;
  await page.getByLabel("Jira project").selectOption("");
  const staleResponse = page.waitForResponse(response => response.url().includes("/api/findings?") && response.status() === 200);
  release();
  await staleResponse;
  await expect(page.getByText("Select a Jira project to see recent tickets.")).toBeVisible();
  await expect(page.getByText("Stale ticket")).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
