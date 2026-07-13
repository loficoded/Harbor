import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Regression guard for the FAssets FIFO redemption model: the redeemer never
 * chooses, prefers, or targets an agent. This spec asserts that the misleading
 * agent-selection copy is absent from the key user-facing pages, and that the
 * replacement FIFO copy is present. It runs under both the desktop-chromium and
 * mobile-chromium projects (see playwright.config.ts).
 */

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "*",
};

/** Phrases that would imply user control over agent assignment. None may appear. */
const FORBIDDEN_PHRASES: readonly RegExp[] = [
  /preferred agent/i,
  /choose your preferred agent/i,
  /choose (an |your )?agent/i,
  /select agent/i,
  /choose agent/i,
  /redeem with this agent/i,
  /prefer this agent/i,
];

async function expectNoAgentSelectionCopy(page: Page): Promise<void> {
  for (const phrase of FORBIDDEN_PHRASES) {
    await expect(page.getByText(phrase)).toHaveCount(0);
  }
  // No agent-selection combobox is present.
  await expect(page.getByRole("combobox", { name: /agent/i })).toHaveCount(0);
}

/** Serve one ranked agent so the statistics table renders in its ready state. */
async function mockAgents(page: Page): Promise<void> {
  await page.route("http://localhost:3001/**", async (route: Route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({
        asset: "FXRP",
        scoreIsHeuristic: true,
        agents: [
          {
            agentVault: "0x00000000000000000000000000000000000000a1",
            score: 87,
            scoreIsHeuristic: true,
            formulaVersion: "v1",
            fulfillmentRate: 1,
            fulfillmentScore: 100,
            settlementTimeScore: 100,
            defaultPenalty: 0,
            availabilityScore: 100,
            collateralScore: 100,
            successfulRedemptions: 10,
            defaultedRedemptions: 0,
            totalTerminalRedemptions: 10,
            averageSettlementSeconds: 60,
            availability: "AVAILABLE",
            availableLots: "12",
            collateralRatioBips: "20000",
            collateralRatioSource: "INVENTORY",
            ftsoStatus: "AVAILABLE",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        generatedAt: "2026-01-01T00:00:00.000Z",
      }),
    });
  });
}

test.describe("No user-controlled agent selection", () => {
  test("the redemption console has no agent selection and explains FIFO", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Redemption console" }),
    ).toBeVisible();
    // Replacement copy is present.
    await expect(
      page.getByText(
        /Agent selection is handled automatically by the FAssets protocol using FIFO/i,
      ),
    ).toBeVisible();
    await expectNoAgentSelectionCopy(page);
  });

  test("the agent statistics page is informational only and explains FIFO", async ({
    page,
  }) => {
    await mockAgents(page);
    await page.goto("/agents");

    await expect(
      page.getByRole("heading", { name: "Agent statistics", exact: true }),
    ).toBeVisible();
    // Wait for the ready table so the assertions cover the loaded content too.
    await expect(
      page
        .locator(
          '[data-testid="agent-row"]:visible, [data-testid="agent-card"]:visible',
        )
        .first(),
    ).toBeVisible();
    await expect(
      page.getByText(
        /handled automatically by the FAssets protocol using FIFO/i,
      ),
    ).toBeVisible();
    await expectNoAgentSelectionCopy(page);
  });
});
