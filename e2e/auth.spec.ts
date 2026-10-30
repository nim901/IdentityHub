import { test, expect } from "@playwright/test";

test("register, duplicate registration, login and logout", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("e2e@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("Account created");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("already registered");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as")).toContainText(
    "e2e@example.test",
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("validation appears on submit, not while typing", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("new@example.test");
  await page.getByLabel("Password").fill("short");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("12 characters");
  await page.getByLabel("Password").fill("long-enough-password");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
