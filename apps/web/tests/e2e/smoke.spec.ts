import { expect, test, type Page, type Route } from "@playwright/test";

import {
  AGENT_A,
  agentView,
  agentsResponse,
} from "../../src/test/agents-fixtures";

/**
 * Shell smoke coverage. This spec runs under both the desktop-chromium and
 * mobile-chromium projects (see playwright.config.ts), so each assertion below
 * doubles as a responsive viewport check for desktop and mobile.
 */

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "*",
};

/**
 * Stub `GET /agents` with a minimal valid ranked-agents payload. The `/agents`
 * route renders its analytics from live backend data, so — like status.spec.ts
 * and agents.spec.ts — the smoke check must serve a response for the page to
 * reach its ready state instead of the no-backend error state.
 */
async function mockAgents(page: Page): Promise<void> {
  await page.route("http://localhost:3001/**", async (route: Route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
      body: JSON.stringify(
        agentsResponse([agentView({ agentVault: AGENT_A })]),
      ),
    });
  });
}

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

  test("loads the agent statistics route", async ({ page }) => {
    await mockAgents(page);
    await page.goto("/agents");

    await expect(
      page.getByRole("heading", { name: "Agent statistics", exact: true }),
    ).toBeVisible();
    // The heuristic framing renders with the leaderboard at every viewport
    // (desktop table and mobile cards alike).
    await expect(page.getByText("Scores are a heuristic")).toBeVisible();
  });

  test("loads a placeholder status route", async ({ page }) => {
    await page.goto("/status/test");

    await expect(
      page.getByRole("heading", { name: "Redemption status" }),
    ).toBeVisible();
    await expect(page.getByText("test", { exact: true })).toBeVisible();
  });
});
