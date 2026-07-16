import type {
  AgentDetails,
  GetAgentsResponse,
  SerializedAgentScoreView,
} from "@harbor/shared";

/**
 * Build an `AgentDetails` value with all fields `null` by default (the
 * "no official metadata" case that triggers address fallbacks). Override only
 * the fields a test exercises, e.g. `agentDetails({ name: "Acme Redeemer" })`.
 */
export function agentDetails(
  overrides: Partial<AgentDetails> = {},
): AgentDetails {
  return {
    name: null,
    description: null,
    iconUrl: null,
    termsOfUseUrl: null,
    ...overrides,
  };
}

/**
 * Test builders for ranked agent data. `agentView` returns a fully-populated
 * serialized score view (as `GET /agents` sends it) with sensible defaults so
 * each test overrides only the fields it exercises; `agentsResponse` wraps a
 * list in the endpoint envelope.
 */
export function agentView(
  overrides: Partial<SerializedAgentScoreView> &
    Pick<SerializedAgentScoreView, "agentVault">,
): SerializedAgentScoreView {
  return {
    score: 50,
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
    averageSettlementSeconds: 120,
    availability: "AVAILABLE",
    availableLots: "100",
    collateralRatioBips: "25000",
    collateralRatioSource: "INVENTORY",
    ftsoStatus: "AVAILABLE",
    details: agentDetails(),
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

export function agentsResponse(
  agents: readonly SerializedAgentScoreView[],
  asset = "FXRP",
): GetAgentsResponse {
  return {
    asset,
    scoreIsHeuristic: true,
    agents,
    generatedAt: "2026-07-09T00:00:00.000Z",
  };
}

/** Distinct agent vault addresses for ordering assertions. */
export const AGENT_A = "0x00000000000000000000000000000000000000a1";
export const AGENT_B = "0x00000000000000000000000000000000000000b2";
export const AGENT_C = "0x00000000000000000000000000000000000000c3";
