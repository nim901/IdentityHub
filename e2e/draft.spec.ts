import { expect, test } from "@playwright/test";

test("draft stays local and confirms before leaving", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("draft@example.test");
  await page.getByLabel("Password").fill("example-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("status").waitFor();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Select a Jira project to see recent tickets.")).toBeVisible();
  await page.getByRole("button", { name: /report finding/i }).click();
  await page.getByLabel("Finding title").fill("Example finding");
  await expect(
    page.getByRole("button", { name: "Create ticket" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Back to findings" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep editing" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Finding title")).toHaveValue("Example finding");
  await expect(page.getByRole("button", { name: "Back to findings" })).toBeFocused();
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.getByRole("button", { name: "Back to findings" }).click();
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Findings", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: /report finding/i }).click();
  await expect(page.getByLabel("Finding title")).toHaveValue("");
  await page.getByLabel("Finding title").fill("Draft before sign out");
  await page.getByRole("button", { name: /draft@example.test/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Finding title")).toHaveValue("Draft before sign out");
  await page.getByRole("button", { name: /draft@example.test/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
