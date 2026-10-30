import { expect, test, type Page } from "@playwright/test";

const password = "example-password-123";

async function register(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Account created");
}

async function signIn(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: `Account: ${email}` })).toBeVisible();
}

test("@verification a real account switch in another tab clears the first user's draft", async ({ page, context }) => {
  const first = "switch-a@example.test";
  const second = "switch-b@example.test";
  await page.goto("/");
  await register(page, first);
  await register(page, second);
  await signIn(page, first);
  await page.getByRole("button", { name: /report finding/i }).click();
  await page.getByLabel("Project key (unverified)").fill("PRIVATE");
  await page.getByLabel("Finding title").fill("First user's private draft");
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await otherTab.getByRole("button", { name: `Account: ${first}` }).click();
  await otherTab.getByRole("menuitem", { name: "Sign out" }).click();
  await signIn(otherTab, second);
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: `Account: ${second}` })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("account changed");
  await page.getByRole("button", { name: /report finding/i }).click();
  await expect(page.getByLabel("Project key (unverified)")).toHaveValue("");
  await expect(page.getByLabel("Finding title")).toHaveValue("");
  await expect(page.getByText("First user's private draft")).toHaveCount(0);
});

test("@verification mobile screens remain within the viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  async function capture(name: string) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  }
  await capture("auth");
  const email = "mobile-very-long-account-name-for-visual-check@example.test";
  await register(page, email);
  await signIn(page, email);
  await capture("findings");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await capture("settings-jira");
  await page.getByRole("tab", { name: "API access" }).click();
  await capture("settings-api");
  await page.getByRole("button", { name: "Findings", exact: true }).click();
  await page.getByRole("button", { name: /report finding/i }).click();
  await capture("report");
  await page.getByLabel("Finding title").fill("Local draft");
  await page.getByRole("button", { name: "Back to findings" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await capture("discard-dialog");
});
