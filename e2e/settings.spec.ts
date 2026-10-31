import { expect, test } from "@playwright/test";

test("settings tabs provide honest unavailable states and keyboard navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("settings@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("status").waitFor();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Connect Jira" }),
  ).toBeEnabled();
  const jiraTab = page.getByRole("tab", { name: "Jira connection" });
  await jiraTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "API access" })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Generate API key" }),
  ).toBeDisabled();
  await expect(page.getByText(/planned.*not available/i)).toBeVisible();
});

test("session expiry clears the draft and explains what happened", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("expiry-ui@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("status").waitFor();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /report finding/i }).click();
  await page.getByLabel("Finding title").fill("Unsaved draft");
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 401 }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText(
    "Any unsent draft was cleared",
  );
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("failed sign out reports uncertainty and can be retried", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("signout-ui@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("status").waitFor();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.getByRole("button", { name: /signout-ui@example.test/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("alert")).toContainText("may still be active");
  await page.unroute("**/api/auth/logout");
  await page.getByRole("button", { name: "Retry sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("temporary session failure preserves a draft and account change clears it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("switch-ui@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("status").waitFor();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /report finding/i }).click();
  await page.getByLabel("Finding title").fill("Private draft");
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText(
    "Unable to load your session",
  );
  await expect(page.getByLabel("Finding title")).toHaveValue("Private draft");
  await page.unroute("**/api/auth/session");
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "other-user", email: "other@example.test" },
        csrfToken: "fake",
      },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("account changed");
  await page.getByRole("button", { name: /report finding/i }).click();
  await expect(page.getByLabel("Finding title")).toHaveValue("");
});

test("a newer focus check supersedes a stalled session request", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("stalled@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("status").waitFor();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /report finding/i }).click();
  await page.getByLabel("Finding title").fill("Private draft");
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let calls = 0;
  await page.route("**/api/auth/session", async (route) => {
    calls++;
    if (calls === 1) {
      firstStarted();
      await release;
      await route
        .fulfill({
          json: {
            user: { id: "stale", email: "stale@example.test" },
            csrfToken: "fake",
          },
        })
        .catch(() => {});
    } else {
      await route.fulfill({ status: 401 });
    }
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await started;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText(
    "Any unsent draft was cleared",
    { timeout: 4000 },
  );
  releaseFirst();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a timed-out session check allows a later retry", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("timeout@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("status").waitFor();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /report finding/i }).click();
  await page.getByLabel("Finding title").fill("Keep this draft");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/api/auth/session", async (route) => {
    calls++;
    if (calls === 1) {
      await pending;
      await route.fulfill({ status: 503 }).catch(() => {});
    } else {
      await route.fulfill({ status: 401 });
    }
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel("Finding title")).toHaveValue(
      "Keep this draft",
    );
    release();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => calls).toBe(2);
    await expect(page.getByRole("alert")).toContainText(
      "Any unsent draft was cleared",
    );
  } finally {
    release();
  }
});
