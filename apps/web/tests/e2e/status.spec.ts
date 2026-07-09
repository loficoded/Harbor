import { expect, test, type Page, type Route } from "@playwright/test";

import {
  proofReadyResponse,
  recoveredResponse,
  settledResponse,
} from "../../src/test/redemption-status-fixtures";

/**
 * Status-view E2E with a fully mocked Harbor backend. Each test stubs
 * `GET /redemptions/:id` with a serialized response fixture and drives the real
 * `/status/[id]` route (client fetch, polling, and rendering). These specs run
 * under both the desktop-chromium and mobile-chromium projects from
 * playwright.config.ts, so every assertion doubles as a responsive viewport
 * check for the status timeline.
 */

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "*",
};

/** Serve a single serialized redemption payload for every backend request. */
async function mockRedemption(page: Page, payload: unknown): Promise<void> {
  await page.route("http://localhost:3001/**", async (route: Route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  });
}

test.describe("Status view — happy path settled receipt", () => {
  test("renders the settlement timeline and receipt", async ({ page }) => {
    await mockRedemption(page, settledResponse({ requestId: "4207" }));
    await page.goto("/status/4207");

    await expect(
      page.getByRole("heading", { name: "Redemption status" }),
    ).toBeVisible();

    // Timeline reaches the settlement milestone.
    await expect(page.getByText("Settled on XRPL")).toBeVisible();

    // Settlement receipt fields are present.
    await expect(page.getByText("Settlement receipt")).toBeVisible();
    await expect(page.getByText("10 FXRP")).toBeVisible();
    await expect(page.getByText("48213377")).toBeVisible();

    // Terminal success stops polling.
    await expect(page.getByText("Final")).toBeVisible();

    // No live self-recovery control on the happy path.
    await expect(
      page.getByRole("button", { name: /self-recovery/i }),
    ).toHaveCount(0);
  });
});

test.describe("Status view — default recovery in progress", () => {
  test("renders the recovery detail and reserved self-recovery placeholder", async ({
    page,
  }) => {
    await mockRedemption(page, proofReadyResponse({ requestId: "5150" }));
    await page.goto("/status/5150");

    await expect(
      page.getByRole("heading", { name: "Redemption status" }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Default recovery" }),
    ).toBeVisible();
    await expect(page.getByText("FDC voting round")).toBeVisible();

    // The self-recovery control is reserved for Prompt #20: present but disabled.
    const selfRecovery = page.getByRole("button", { name: /self-recovery/i });
    await expect(selfRecovery).toBeVisible();
    await expect(selfRecovery).toBeDisabled();
  });
});

test.describe("Status view — recovered default path", () => {
  test("renders the recovered terminal state with the default tx", async ({
    page,
  }) => {
    await mockRedemption(page, recoveredResponse({ requestId: "6100" }));
    await page.goto("/status/6100");

    await expect(
      page.getByRole("heading", { name: "Redemption status" }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Default recovery" }),
    ).toBeVisible();
    await expect(page.getByText("Default tx hash")).toBeVisible();
    // Recovered is terminal, so polling is final and the placeholder is gone.
    await expect(page.getByText("Final")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /self-recovery/i }),
    ).toHaveCount(0);
  });
});

test.describe("Status view — not found", () => {
  test("renders a not-found state for an unknown id", async ({ page }) => {
    await page.route("http://localhost:3001/**", async (route: Route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }
      await route.fulfill({
        status: 404,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({
          error: {
            code: "NOT_FOUND",
            message: 'Redemption "9999" was not found',
            requestId: "req-e2e",
            details: null,
          },
        }),
      });
    });
    await page.goto("/status/9999");

    await expect(page.getByText("Redemption not found")).toBeVisible();
  });
});
