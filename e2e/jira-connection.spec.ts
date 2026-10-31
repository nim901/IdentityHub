import { expect, test } from "@playwright/test";

test("@jira connects a Jira site and selects a project through the app API", async ({
  page,
  context,
}, testInfo) => {
  await page.route("https://auth.atlassian.com/**", async (route) => {
    const url = new URL(route.request().url());
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "fake-code");
    callback.searchParams.set("state", url.searchParams.get("state")!);
    await route.fulfill({
      status: 302,
      headers: { location: callback.toString() },
    });
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("jira-e2e@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("status").waitFor();
  await page.getByLabel("Email").fill("jira-other@example.test");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Account created");
  await page.getByLabel("Email").fill("jira-e2e@example.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText("Jira connected. Choose a site.")).toBeVisible();
  await page.getByLabel("Jira site").selectOption("site-one");
  await page.route("**/api/jira/site", (route) => route.fulfill({ status: 403 }));
  await page.getByRole("button", { name: "Save site" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not select this site");
  await page.unroute("**/api/jira/site");
  await page.route("**/api/jira/projects", (route) => route.fulfill({ json: { projects: [] } }), { times: 1 });
  await page.getByRole("button", { name: "Save site" }).click();
  await expect(page.getByText("Site selected.")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: testInfo.outputPath("jira-settings.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Findings", exact: true }).click();
  await expect(page.getByText("No projects available. Check your Jira access.")).toBeVisible();
  await page.route("**/api/jira/projects", route => route.fulfill({ status: 503 }), { times: 1 });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Could not load projects");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("Could not load projects");
  await page.getByRole("button", { name: "Retry projects" }).click();
  await page.getByLabel("Jira project").selectOption("ONE");
  await expect(page.getByLabel("Jira project")).toHaveValue("ONE");
  await expect(
    page.getByText(/ticket history is not available/i),
  ).toBeVisible();
  await page.route("**/api/jira/status", (route) => route.fulfill({ json: { configured: true, connected: true, site: { id: "site-two", name: "Other workspace", url: "https://other.atlassian.net" } } }));
  await page.route("**/api/jira/projects", (route) => route.fulfill({ json: { projects: [] } }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Other workspace")).toBeVisible();
  await page.unroute("**/api/jira/status");
  await page.unroute("**/api/jira/projects");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Example workspace")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  let releaseSite!: () => void;
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const pending = new Promise<void>((resolve) => { releaseSite = resolve; });
  await page.route("**/api/jira/site", async (route) => {
    signalStarted();
    await pending;
    await route.fulfill({ json: { message: "Jira site selected" } });
  });
  await page.getByRole("button", { name: "Save site" }).click();
  await started;
  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: /jira-e2e@example.test/ }).click();
  await other.getByRole("menuitem", { name: "Sign out" }).click();
  await other.getByLabel("Email").fill("jira-other@example.test");
  await other.getByLabel("Password").fill("example-password-123");
  await other.getByRole("button", { name: "Sign in" }).click();
  await expect(
    other.getByRole("button", { name: /jira-other@example.test/ }),
  ).toBeVisible();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: /jira-other@example.test/ }),
  ).toBeVisible();
  releaseSite();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: /jira-other@example.test/ })).toBeVisible();
  await expect(page.getByLabel("Jira project")).toHaveCount(0);
  await expect(page.getByText("Identity operations")).toHaveCount(0);
});

test("@jira explains connection and session failures safely", async ({
  page,
}) => {
  await page.goto("/?jira=expired");
  await expect(page.getByRole("alert")).toContainText(
    "session ended during Jira connection",
  );
  await page.getByLabel("Email").fill("jira-errors@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("status").waitFor();
  await page.route("**/api/jira/status", (route) =>
    route.fulfill({ status: 503, body: "private upstream error" }),
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not load Jira connection",
  );
  await expect(page.getByText("private upstream error")).toHaveCount(0);
  await page.unroute("**/api/jira/status");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("button", { name: "Connect Jira" }),
  ).toBeEnabled();
});
