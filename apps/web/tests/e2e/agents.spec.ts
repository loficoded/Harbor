import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";

/**
 * Agent leaderboard E2E with a fully mocked Harbor backend. Each test stubs
 * `GET /agents` and drives the real `/agents` route (client fetch, sorting,
 * filtering, and rendering). These specs run under both the desktop-chromium
 * and mobile-chromium projects from playwright.config.ts, so every assertion
 * doubles as a responsive check: `visibleItems` targets whichever layout — the
 * desktop table or the mobile cards — is actually visible at that viewport.
 */

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "*",
};

const AGENT_A = "0x00000000000000000000000000000000000000a1"; // suffix 00a1
const AGENT_B = "0x00000000000000000000000000000000000000b2"; // suffix 00b2
const AGENT_C = "0x00000000000000000000000000000000000000c3"; // suffix 00c3

type AgentInit = {
  agentVault: string;
  score?: number;
  availableLots?: string;
  availability?: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  averageSettlementSeconds?: number | null;
  collateralRatioBips?: string | null;
  collateralRatioSource?: "INVENTORY" | "FTSO_DERIVED" | "UNAVAILABLE";
  ftsoStatus?: "AVAILABLE" | "UNAVAILABLE" | "STALE" | "FAILED";
};

function agent(init: AgentInit): Record<string, unknown> {
  return {
    agentVault: init.agentVault,
    score: init.score ?? 50,
    scoreIsHeuristic: true,
    formulaVersion: "agent-reliability-mvp-v1",
    fulfillmentRate: 1,
    fulfillmentScore: 40,
    settlementTimeScore: 20,
    defaultPenalty: 0,
    availabilityScore: 20,
    collateralScore: 20,
    successfulRedemptions: 5,
    defaultedRedemptions: 0,
    totalTerminalRedemptions: 5,
    averageSettlementSeconds:
      init.averageSettlementSeconds === undefined
        ? 120
        : init.averageSettlementSeconds,
    availability: init.availability ?? "AVAILABLE",
    availableLots: init.availableLots ?? "100",
    collateralRatioBips:
      init.collateralRatioBips === undefined
        ? "25000"
        : init.collateralRatioBips,
    collateralRatioSource: init.collateralRatioSource ?? "INVENTORY",
    ftsoStatus: init.ftsoStatus ?? "AVAILABLE",
    updatedAt: "2026-07-08T00:00:00.000Z",
  };
}

/** Serve a ranked agents payload for every backend request. */
async function mockAgents(
  page: Page,
  agents: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
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
        agents,
        generatedAt: "2026-07-09T00:00:00.000Z",
      }),
    });
  });
}

/** Rows or cards from whichever responsive layout is visible at this viewport. */
function visibleItems(page: Page): Locator {
  return page.locator(
    '[data-testid="agent-row"]:visible, [data-testid="agent-card"]:visible',
  );
}

test.describe("Agents leaderboard — ranking, sorting, filtering", () => {
  test("ranks agents and reflects sort and filter controls", async ({
    page,
  }) => {
    await mockAgents(page, [
      agent({ agentVault: AGENT_B, score: 90, availableLots: "50" }),
      agent({ agentVault: AGENT_C, score: 65, availableLots: "333" }),
      agent({
        agentVault: AGENT_A,
        score: 40,
        availableLots: "111",
        availability: "UNAVAILABLE",
      }),
    ]);
    await page.goto("/agents");

    await expect(
      page.getByRole("heading", { name: "Agents", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Scores are a heuristic")).toBeVisible();

    // Default ranking is highest-score first.
    await expect(visibleItems(page)).toHaveCount(3);
    await expect(visibleItems(page).nth(0)).toContainText("00b2");
    await expect(visibleItems(page).nth(1)).toContainText("00c3");
    await expect(visibleItems(page).nth(2)).toContainText("00a1");

    // Sort by most available lots.
    await page
      .getByRole("combobox", { name: /sort by/i })
      .selectOption("availableLots");
    await expect(visibleItems(page).nth(0)).toContainText("00c3"); // 333
    await expect(visibleItems(page).nth(1)).toContainText("00a1"); // 111
    await expect(visibleItems(page).nth(2)).toContainText("00b2"); // 50

    // Hide unavailable agents removes agent A.
    await page
      .getByRole("checkbox", { name: /hide unavailable agents/i })
      .check();
    await expect(visibleItems(page)).toHaveCount(2);
    await expect(page.getByText(/00a1/)).toHaveCount(0);
  });

  test("surfaces a stale indicator for FTSO-derived collateral", async ({
    page,
  }) => {
    await mockAgents(page, [
      agent({
        agentVault: AGENT_C,
        score: 70,
        collateralRatioSource: "FTSO_DERIVED",
        collateralRatioBips: "20000",
        ftsoStatus: "STALE",
      }),
    ]);
    await page.goto("/agents");

    const top = visibleItems(page).first();
    await expect(top).toContainText("FTSO-derived");
    await expect(top).toContainText("Stale");
  });
});

test.describe("Agents leaderboard — non-ready states", () => {
  test("renders the empty state when no agents are scored", async ({
    page,
  }) => {
    await mockAgents(page, []);
    await page.goto("/agents");

    await expect(page.getByText("No ranked agents yet")).toBeVisible();
    await expect(page.getByRole("combobox", { name: /sort by/i })).toHaveCount(
      0,
    );
  });

  test("renders the error state when the backend fails", async ({ page }) => {
    await page.route("http://localhost:3001/**", async (route: Route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }
      await route.fulfill({
        status: 503,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({
          error: {
            code: "unavailable",
            message: "Backend unavailable",
            requestId: "req-e2e",
            details: null,
          },
        }),
      });
    });
    await page.goto("/agents");

    await expect(page.getByText("Could not load agents")).toBeVisible();
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
  });
});
