import { expect, test } from "@playwright/test";

/**
 * Shell smoke coverage. This spec runs under both the desktop-chromium and
 * mobile-chromium projects (see playwright.config.ts), so each assertion below
 * doubles as a responsive viewport check for desktop and mobile.
 */
test.describe("Harbor shell smoke", () => {
  test("loads the overview console with navigation", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Redemption console" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Overview", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Agents", exact: true }),
    ).toBeVisible();
  });

  test("loads the agents placeholder route", async ({ page }) => {
    await page.goto("/agents");

    await expect(
      page.getByRole("heading", { name: "Agents", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Agent comparison is coming soon"),
    ).toBeVisible();
  });

  test("loads a placeholder status route", async ({ page }) => {
    await page.goto("/status/test");

    await expect(
      page.getByRole("heading", { name: "Redemption status" }),
    ).toBeVisible();
    await expect(page.getByText("test", { exact: true })).toBeVisible();
  });
});
