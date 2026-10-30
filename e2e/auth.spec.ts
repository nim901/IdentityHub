import { test, expect } from "@playwright/test";

test("register, duplicate registration, login and logout", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("e2e@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Account created");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("already registered");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /e2e@example.test/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("validation appears on submit, not while typing", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("new@example.test");
  await page.getByLabel("Password").fill("short");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("12 characters");
  await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Password")).toHaveAttribute("aria-describedby", "password-error");
  await page.getByLabel("Password").fill("long-enough-password");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("invalid email is explained beside the field", async ({ page }) => {
  await page.goto("/");
  const email = page.getByLabel("Email");
  await email.fill("invalid");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAttribute("aria-describedby", "email-error");
  await expect(page.locator("#email-error")).toContainText("valid email");
  await email.fill("valid@example.test");
  await expect(page.locator("#email-error")).toHaveCount(0);
});

test("session errors offer a retry", async ({ page }) => {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({ status: 503 });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Unable to load your session");
  await page.unroute("**/api/auth/session");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
test("account menu supports keyboard and reports unavailable services", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("menu@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  const account = page.getByRole("button", { name: /menu@example.test/ });
  await account.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(account).toBeFocused();
  await expect(page.getByText(/Jira integration is not available/i)).toBeVisible();
});
