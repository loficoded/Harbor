import { describe, expect, it } from "vitest";

import {
  agentAvailabilityLabel,
  agentAvailabilityTone,
  collateralFieldIndicator,
  filterAgents,
  formatCollateralRatioBips,
  formatFulfillmentRate,
  formatLots,
  formatScoreBreakdown,
  formatSettlementSeconds,
  rankAgents,
  sortAgents,
} from "@/lib/agents";
import { AGENT_A, AGENT_B, AGENT_C, agentView } from "@/test/agents-fixtures";

const order = (agents: ReadonlyArray<{ agentVault: string }>) =>
  agents.map((agent) => agent.agentVault);

describe("sortAgents", () => {
  const agents = [
    agentView({
      agentVault: AGENT_A,
      score: 40,
      availableLots: "111",
      averageSettlementSeconds: 300,
    }),
    agentView({
      agentVault: AGENT_B,
      score: 90,
      availableLots: "50",
      averageSettlementSeconds: 900,
    }),
    agentView({
      agentVault: AGENT_C,
      score: 65,
      availableLots: "333",
      averageSettlementSeconds: 120,
    }),
  ];

  it("ranks by highest score by default", () => {
    expect(order(sortAgents(agents))).toEqual([AGENT_B, AGENT_C, AGENT_A]);
  });

  it("ranks by most available lots (bigint-aware)", () => {
    expect(order(sortAgents(agents, "availableLots"))).toEqual([
      AGENT_C,
      AGENT_A,
      AGENT_B,
    ]);
  });

  it("ranks by fastest average settlement", () => {
    expect(order(sortAgents(agents, "settlement"))).toEqual([
      AGENT_C,
      AGENT_A,
      AGENT_B,
    ]);
  });

  it("sorts agents with no settlement history last", () => {
    const withNull = [
      agentView({ agentVault: AGENT_A, averageSettlementSeconds: null }),
      agentView({ agentVault: AGENT_B, averageSettlementSeconds: 500 }),
    ];
    expect(order(sortAgents(withNull, "settlement"))).toEqual([
      AGENT_B,
      AGENT_A,
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [
      agentView({ agentVault: AGENT_A, score: 10 }),
      agentView({ agentVault: AGENT_B, score: 20 }),
    ];
    const snapshot = order(input);
    sortAgents(input, "score");
    expect(order(input)).toEqual(snapshot);
  });

  it("breaks ties deterministically by vault address", () => {
    const tied = [
      agentView({ agentVault: AGENT_C, score: 50 }),
      agentView({ agentVault: AGENT_A, score: 50 }),
      agentView({ agentVault: AGENT_B, score: 50 }),
    ];
    expect(order(sortAgents(tied, "score"))).toEqual([
      AGENT_A,
      AGENT_B,
      AGENT_C,
    ]);
  });
});

describe("filterAgents", () => {
  const agents = [
    agentView({ agentVault: AGENT_A, availability: "AVAILABLE" }),
    agentView({ agentVault: AGENT_B, availability: "UNAVAILABLE" }),
    agentView({ agentVault: AGENT_C, availability: "UNKNOWN" }),
  ];

  it("keeps every agent when hideUnavailable is false", () => {
    expect(filterAgents(agents, { hideUnavailable: false })).toHaveLength(3);
  });

  it("keeps only AVAILABLE agents when hideUnavailable is true", () => {
    const filtered = filterAgents(agents, { hideUnavailable: true });
    expect(order(filtered)).toEqual([AGENT_A]);
  });
});

describe("rankAgents", () => {
  it("sorts then filters in one pass", () => {
    const agents = [
      agentView({ agentVault: AGENT_A, score: 40, availability: "AVAILABLE" }),
      agentView({
        agentVault: AGENT_B,
        score: 90,
        availability: "UNAVAILABLE",
      }),
      agentView({ agentVault: AGENT_C, score: 65, availability: "AVAILABLE" }),
    ];
    const ranked = rankAgents(agents, "score", { hideUnavailable: true });
    expect(order(ranked)).toEqual([AGENT_C, AGENT_A]);
  });
});

describe("display formatters", () => {
  it("formats fulfillment rate as a whole percent or em dash", () => {
    expect(formatFulfillmentRate(1)).toBe("100%");
    expect(formatFulfillmentRate(0.5)).toBe("50%");
    expect(formatFulfillmentRate(null)).toBe("—");
  });

  it("formats settlement durations compactly", () => {
    expect(formatSettlementSeconds(45)).toBe("45s");
    expect(formatSettlementSeconds(120)).toBe("2m");
    expect(formatSettlementSeconds(150)).toBe("2m 30s");
    expect(formatSettlementSeconds(3900)).toBe("1h 5m");
    expect(formatSettlementSeconds(null)).toBe("—");
  });

  it("formats collateral ratio basis points as a percentage", () => {
    expect(formatCollateralRatioBips("25000")).toBe("250%");
    expect(formatCollateralRatioBips("12550")).toBe("125.5%");
    expect(formatCollateralRatioBips(null)).toBe("—");
  });

  it("groups lot counts for scanning", () => {
    expect(formatLots("1000")).toBe("1,000");
    expect(formatLots("50")).toBe("50");
  });

  it("labels and tones availability", () => {
    expect(agentAvailabilityLabel("AVAILABLE")).toBe("Available");
    expect(agentAvailabilityLabel("UNAVAILABLE")).toBe("Unavailable");
    expect(agentAvailabilityLabel("UNKNOWN")).toBe("Unknown");
    expect(agentAvailabilityTone("AVAILABLE")).toBe("success");
    expect(agentAvailabilityTone("UNAVAILABLE")).toBe("warning");
  });

  it("renders the signed score component explanation", () => {
    const explanation = formatScoreBreakdown(
      agentView({
        agentVault: AGENT_A,
        fulfillmentScore: 40,
        settlementTimeScore: 20,
        availabilityScore: 20,
        collateralScore: 20,
        defaultPenalty: 5,
      }),
    );
    expect(explanation).toBe(
      "Fulfillment +40 · Settlement time +20 · Availability +20 · Collateral +20 · Default penalty −5",
    );
  });
});

describe("collateralFieldIndicator", () => {
  it("returns no caveat for a fresh inventory-sourced ratio", () => {
    const indicator = collateralFieldIndicator(
      agentView({
        agentVault: AGENT_A,
        collateralRatioSource: "INVENTORY",
        collateralRatioBips: "25000",
        ftsoStatus: "AVAILABLE",
      }),
    );
    expect(indicator).toBeNull();
  });

  it("flags a stale FTSO-derived ratio", () => {
    const indicator = collateralFieldIndicator(
      agentView({
        agentVault: AGENT_A,
        collateralRatioSource: "FTSO_DERIVED",
        collateralRatioBips: "20000",
        ftsoStatus: "STALE",
      }),
    );
    expect(indicator?.label).toBe("Stale");
    expect(indicator?.tone).toBe("warning");
  });

  it("flags a failed FTSO read on a derived ratio", () => {
    const indicator = collateralFieldIndicator(
      agentView({
        agentVault: AGENT_A,
        collateralRatioSource: "FTSO_DERIVED",
        collateralRatioBips: "20000",
        ftsoStatus: "FAILED",
      }),
    );
    expect(indicator?.label).toBe("FTSO unavailable");
  });

  it("flags an unavailable collateral ratio", () => {
    const indicator = collateralFieldIndicator(
      agentView({
        agentVault: AGENT_A,
        collateralRatioSource: "UNAVAILABLE",
        collateralRatioBips: null,
        ftsoStatus: "UNAVAILABLE",
      }),
    );
    expect(indicator?.label).toBe("Unavailable");
  });

  it("does not flag an inventory ratio even when FTSO feeds are stale", () => {
    const indicator = collateralFieldIndicator(
      agentView({
        agentVault: AGENT_A,
        collateralRatioSource: "INVENTORY",
        collateralRatioBips: "25000",
        ftsoStatus: "STALE",
      }),
    );
    expect(indicator).toBeNull();
  });
});
