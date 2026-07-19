import { deriveRedemptionStatusViewModel } from "@/lib/redemption-status";
import type { RankedAgent } from "@/lib/agents";
import type { GetRedemptionResponse } from "@harbor/shared";

/**
 * Harness fixtures.
 *
 * Every value here is a realistic, self-consistent snapshot of the Harbor
 * domain model — not a copy of any live redemption. Wallets are 0x EVM
 * addresses, XRPL destinations are `r…` addresses, transaction hashes are
 * `0x` + 64 hex, FXRP amounts are plausible Coston2 figures, and agent
 * identity (name + icon) is sourced from the live FAssets `AgentOwnerRegistry`
 * so the screenshots match what the console actually renders in production.
 *
 * The icon is served from the app's own public dir so the screenshot run is
 * fully offline and deterministic.
 */

export const HARNESS_AGENT_ICON_URL = "http://localhost:3000/agent-icon.png";

export const HARNESS_WALLET_ADDRESS =
  "0x7C2a48B93D5e6A1F2C3B4D5e6F7A8B9C0D1E2F3A";

export const HARBOR_REDEEMER_ADDRESS =
  "0x82f39361FFb1a438e4EBF8025efa06e4511b02b5";

export const FXRP_ASSET_MANAGER_ADDRESS =
  "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";

export const HARNESS_XRPL_DESTINATION = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

export const HARNESS_AGENT_SOURCE_ADDRESS =
  "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv";

// 0x + 64 hex — transaction hashes and bytes32 references.
export const HARNESS_REDEEM_TX_HASH =
  "0x5b24e8f1a3c7d9e6b4a2f8c1d5e7b3a9f6c4d2e8b1a7c5d3f9e6b4a2c8d1f7e3";
export const HARNESS_REDEEM_WITH_TAG_TX_HASH =
  "0x4a13e7c2b6d9f1a8e3c5b7d2f4a9c1e6b8d3f5a7c2e9b1d4f6a8c3e5b7d2f9a1";
export const HARNESS_XRPL_TX_HASH =
  "0x7e3c1a9f5b2d8e6c4a7f1b3d9e5c2a8f6d4b1e7c3a9f5d2b8e6c4a7f1b3d9e5c";
export const HARNESS_XRPL_WITH_TAG_TX_HASH =
  "0x8f4d2b6e9a1c7f3b5d8e2a4c6f9b1d7e3a5c8f2b4d6e9a1c7f3b5d8e2a4c6f9b";
export const HARNESS_DEFAULT_TX_HASH =
  "0x9f2c5a8e3b1d7f4c6a9e2b5d8f1c4a7e3b6d9f2c5a8e1b4d7f3c6a9e2b5d8f1c";
export const HARNESS_PAYMENT_REFERENCE =
  "0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
export const HARNESS_ATTESTATION_TYPE =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
export const HARNESS_SOURCE_ID =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
export const HARNESS_REQUEST_HASH =
  "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321";
export const HARNESS_RESPONSE_BODY =
  "0x0000000000000000000000000000000000000000000000000000000000000020" +
  "000000000000000000000000000000000000000000000000000000000000000a" +
  "0000000000000000000000000000000000000000000000000000000000000001";
export const HARNESS_MERKLE_PROOF: readonly string[] = [
  "0x1111111111111111111111111111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333333333333333333333333333",
  "0x4444444444444444444444444444444444444444444444444444444444444444",
];

// Official agent vaults/names mirror the live FAssets registry (read from the
// production API). Scores are realistic, varied heuristics (42–100) with a
// transparent term-by-term breakdown so the leaderboard demonstrates the
// breakdown affordance — they are NOT the live scores.
export type HarnessAgent = RankedAgent;

const baseAgent = {
  scoreIsHeuristic: true as const,
  formulaVersion: "agent-reliability-mvp-v1",
  collateralRatioSource: "INVENTORY" as const,
  ftsoStatus: "AVAILABLE" as const,
  updatedAt: "2026-07-13T09:12:50.608Z",
};

export const HARNESS_AGENTS: readonly RankedAgent[] = [
  {
    ...baseAgent,
    agentVault: "0x165c62b4531d28e34c68a8b2acbf4d0421e4e028",
    score: 96,
    fulfillmentRate: 0.98,
    fulfillmentScore: 44,
    settlementTimeScore: 14,
    defaultPenalty: 0,
    availabilityScore: 18,
    collateralScore: 20,
    successfulRedemptions: 1084,
    defaultedRedemptions: 0,
    totalTerminalRedemptions: 1084,
    averageSettlementSeconds: 42,
    availability: "AVAILABLE",
    availableLots: "131",
    collateralRatioBips: "27723",
    details: {
      name: "Oracle-Daemon 1",
      description: "Oracle Daemon auxiliary agent bot",
      iconUrl: HARNESS_AGENT_ICON_URL,
      termsOfUseUrl: null,
    },
  },
  {
    ...baseAgent,
    agentVault: "0x55c815260cbe6c45fe5bfe5ff32e3c7d746f14dc",
    score: 87,
    fulfillmentRate: 0.95,
    fulfillmentScore: 42,
    settlementTimeScore: 13,
    defaultPenalty: 0,
    availabilityScore: 15,
    collateralScore: 17,
    successfulRedemptions: 249,
    defaultedRedemptions: 0,
    totalTerminalRedemptions: 249,
    averageSettlementSeconds: 96,
    availability: "AVAILABLE",
    availableLots: "490",
    collateralRatioBips: "18800",
    details: {
      name: "Oracle-Daemon",
      description: "Oracle Daemon agent bot open beta",
      iconUrl: HARNESS_AGENT_ICON_URL,
      termsOfUseUrl: null,
    },
  },
  {
    ...baseAgent,
    agentVault: "0xd5defe2c62d48788bb3889534fbfe7aea0602d64",
    score: 74,
    fulfillmentRate: 0.89,
    fulfillmentScore: 40,
    settlementTimeScore: 11,
    defaultPenalty: 0,
    availabilityScore: 13,
    collateralScore: 10,
    successfulRedemptions: 941,
    defaultedRedemptions: 0,
    totalTerminalRedemptions: 941,
    averageSettlementSeconds: 128,
    availability: "AVAILABLE",
    availableLots: "880",
    collateralRatioBips: "16000",
    details: {
      name: "White-Knight",
      description: "Friendly liquidator for open beta",
      iconUrl: HARNESS_AGENT_ICON_URL,
      termsOfUseUrl: null,
    },
  },
  {
    ...baseAgent,
    agentVault: "0x5b89514d1f060adbea8b7294aff81ed8dbaa7fc5",
    score: 48,
    fulfillmentRate: 0.78,
    fulfillmentScore: 35,
    settlementTimeScore: 8,
    defaultPenalty: 10,
    availabilityScore: 10,
    collateralScore: 5,
    successfulRedemptions: 1074,
    defaultedRedemptions: 2,
    totalTerminalRedemptions: 1076,
    averageSettlementSeconds: 214,
    availability: "UNAVAILABLE",
    availableLots: "52",
    collateralRatioBips: "14000",
    details: {
      name: "Oracle-Daemon 2",
      description: "Oracle Daemon auxiliary agent bot",
      iconUrl: HARNESS_AGENT_ICON_URL,
      termsOfUseUrl: null,
    },
  },
];

// ---------------------------------------------------------------------------
// Redemption fixtures
// ---------------------------------------------------------------------------

const FXRP_VALUE_UBA = "42500000"; // 42.5 FXRP (6 decimals)
const FXRP_FEE_UBA = "75000"; // 0.075 FXRP agent fee → net 42.425 FXRP
const FXRP_NET_DELIVERED_UBA = "42425000";
const EXECUTOR_FEE_NAT_WEI = "100000000000000000"; // 0.1 C2FLR
const WITH_TAG_DESTINATION = "314159";

function agentDetails(name: string, description: string) {
  return {
    name,
    description,
    iconUrl: HARNESS_AGENT_ICON_URL,
    termsOfUseUrl: null,
  };
}

/** Standard-lane SETTLED redemption (happy path). */
export const SETTLED_RESPONSE: GetRedemptionResponse = {
  redemption: {
    requestId: "38217645",
    assetManagerAddress: FXRP_ASSET_MANAGER_ADDRESS,
    status: "SETTLED",
    statusReason: null,
    redeemer: HARNESS_WALLET_ADDRESS,
    agentVault: "0x165c62b4531d28e34c68a8b2acbf4d0421e4e028",
    agentDetails: agentDetails(
      "Oracle-Daemon 1",
      "Oracle Daemon auxiliary agent bot",
    ),
    paymentAddress: HARNESS_XRPL_DESTINATION,
    redemptionKind: "STANDARD",
    destinationTag: null,
    valueUBA: FXRP_VALUE_UBA,
    feeUBA: FXRP_FEE_UBA,
    paymentReference: HARNESS_PAYMENT_REFERENCE,
    transactionHash: HARNESS_REDEEM_TX_HASH,
    defaultTransactionHash: null,
    executor: HARBOR_REDEEMER_ADDRESS,
    executorFeeNatWei: EXECUTOR_FEE_NAT_WEI,
    firstUnderlyingBlock: "48213900",
    lastUnderlyingBlock: "48214540",
    lastUnderlyingTimestamp: "1752398122",
    createdAt: "2026-07-13T09:14:22.000Z",
    updatedAt: "2026-07-13T09:18:07.000Z",
  },
  statusTimeline: [
    {
      status: "REQUESTED",
      occurredAt: "2026-07-13T09:14:22.000Z",
      source: "REDEMPTION",
      detail: "Redemption requested on the FXRP AssetManager (redeemAmount).",
    },
    {
      status: "WATCHING",
      occurredAt: "2026-07-13T09:14:35.000Z",
      source: "KEEPER",
      detail:
        "Payment window opened; keeper watching the agent's XRPL address.",
    },
    {
      status: "SETTLED",
      occurredAt: "2026-07-13T09:18:07.000Z",
      source: "XRPL_OBSERVATION",
      detail:
        "Validated XRPL payment matched the redemption destination and net amount.",
    },
  ],
  xrplReceipts: [
    {
      observationId: "obs_38217645_1",
      redemptionRequestId: "38217645",
      transactionHash: HARNESS_XRPL_TX_HASH,
      sourceAddress: HARNESS_AGENT_SOURCE_ADDRESS,
      destinationAddress: HARNESS_XRPL_DESTINATION,
      deliveredAmountUBA: FXRP_NET_DELIVERED_UBA,
      feeDrops: "12",
      paymentReference: HARNESS_PAYMENT_REFERENCE,
      ledgerIndex: "49231847",
      closeTimestamp: "2026-07-13T09:18:04.000Z",
      validatedAt: "2026-07-13T09:18:06.000Z",
      destinationTag: null,
      createdAt: "2026-07-13T09:18:06.000Z",
    },
  ],
  fdcRequests: [],
  fdcProofs: [],
  defaultTransactionHash: null,
  generatedAt: "2026-07-13T09:19:50.000Z",
};

/** Standard-lane PROOF_READY redemption (recovery in progress). */
export const RECOVERY_RESPONSE: GetRedemptionResponse = {
  redemption: {
    requestId: "38216902",
    assetManagerAddress: FXRP_ASSET_MANAGER_ADDRESS,
    status: "PROOF_READY",
    statusReason:
      "Agent missed the payment window; the FDC non-payment proof is ready to submit.",
    redeemer: HARNESS_WALLET_ADDRESS,
    agentVault: "0x55c815260cbe6c45fe5bfe5ff32e3c7d746f14dc",
    agentDetails: agentDetails(
      "Oracle-Daemon",
      "Oracle Daemon agent bot open beta",
    ),
    paymentAddress: HARNESS_XRPL_DESTINATION,
    redemptionKind: "STANDARD",
    destinationTag: null,
    valueUBA: FXRP_VALUE_UBA,
    feeUBA: FXRP_FEE_UBA,
    paymentReference: HARNESS_PAYMENT_REFERENCE,
    transactionHash: HARNESS_REDEEM_TX_HASH,
    defaultTransactionHash: null,
    executor: HARBOR_REDEEMER_ADDRESS,
    executorFeeNatWei: EXECUTOR_FEE_NAT_WEI,
    firstUnderlyingBlock: "48210900",
    lastUnderlyingBlock: "48211540",
    lastUnderlyingTimestamp: "1752387122",
    createdAt: "2026-07-13T08:02:11.000Z",
    updatedAt: "2026-07-13T08:41:33.000Z",
  },
  statusTimeline: [
    {
      status: "REQUESTED",
      occurredAt: "2026-07-13T08:02:11.000Z",
      source: "REDEMPTION",
      detail: "Redemption requested on the FXRP AssetManager (redeemAmount).",
    },
    {
      status: "REQUEST_PROOF",
      occurredAt: "2026-07-13T08:22:45.000Z",
      source: "FDC_REQUEST",
      detail: "ReferencedPaymentNonexistence attestation submitted to the FDC.",
    },
    {
      status: "PROOF_READY",
      occurredAt: "2026-07-13T08:41:33.000Z",
      source: "FDC_PROOF",
      detail:
        "Voting round finalized; Merkle proof retrieved and ready to submit.",
    },
  ],
  xrplReceipts: [],
  fdcRequests: [
    {
      fdcRequestId: "fdc_38216902_1",
      redemptionRequestId: "38216902",
      attestationType: HARNESS_ATTESTATION_TYPE,
      sourceId: HARNESS_SOURCE_ID,
      requestBody:
        "0x0000000000000000000000000000000000000000000000000000000000000020",
      requestHash: HARNESS_REQUEST_HASH,
      status: "PROOF_READY",
      votingRoundId: "12",
      createdAt: "2026-07-13T08:22:45.000Z",
      updatedAt: "2026-07-13T08:41:33.000Z",
    },
  ],
  fdcProofs: [
    {
      fdcProofId: "proof_38216902_1",
      fdcRequestId: "fdc_38216902_1",
      redemptionRequestId: "38216902",
      requestHash: HARNESS_REQUEST_HASH,
      responseBody: HARNESS_RESPONSE_BODY,
      merkleProof: HARNESS_MERKLE_PROOF,
      votingRoundId: "12",
      createdAt: "2026-07-13T08:41:33.000Z",
    },
  ],
  defaultTransactionHash: null,
  generatedAt: "2026-07-13T08:42:50.000Z",
};

/** Standard-lane RECOVERED redemption (default recovered). */
export const RECOVERED_RESPONSE: GetRedemptionResponse = {
  redemption: {
    requestId: "38216902",
    assetManagerAddress: FXRP_ASSET_MANAGER_ADDRESS,
    status: "RECOVERED",
    statusReason:
      "Default recovered — the AssetManager released the redemption collateral to the redeemer.",
    redeemer: HARNESS_WALLET_ADDRESS,
    agentVault: "0x55c815260cbe6c45fe5bfe5ff32e3c7d746f14dc",
    agentDetails: agentDetails(
      "Oracle-Daemon",
      "Oracle Daemon agent bot open beta",
    ),
    paymentAddress: HARNESS_XRPL_DESTINATION,
    redemptionKind: "STANDARD",
    destinationTag: null,
    valueUBA: FXRP_VALUE_UBA,
    feeUBA: FXRP_FEE_UBA,
    paymentReference: HARNESS_PAYMENT_REFERENCE,
    transactionHash: HARNESS_REDEEM_TX_HASH,
    defaultTransactionHash: HARNESS_DEFAULT_TX_HASH,
    executor: HARBOR_REDEEMER_ADDRESS,
    executorFeeNatWei: EXECUTOR_FEE_NAT_WEI,
    firstUnderlyingBlock: "48210900",
    lastUnderlyingBlock: "48211540",
    lastUnderlyingTimestamp: "1752387122",
    createdAt: "2026-07-13T08:02:11.000Z",
    updatedAt: "2026-07-13T09:02:14.000Z",
  },
  statusTimeline: [
    {
      status: "REQUESTED",
      occurredAt: "2026-07-13T08:02:11.000Z",
      source: "REDEMPTION",
      detail: "Redemption requested on the FXRP AssetManager (redeemAmount).",
    },
    {
      status: "REQUEST_PROOF",
      occurredAt: "2026-07-13T08:22:45.000Z",
      source: "FDC_REQUEST",
      detail: "ReferencedPaymentNonexistence attestation submitted to the FDC.",
    },
    {
      status: "PROOF_READY",
      occurredAt: "2026-07-13T08:41:33.000Z",
      source: "FDC_PROOF",
      detail:
        "Voting round finalized; Merkle proof retrieved and ready to submit.",
    },
    {
      status: "DEFAULT_SUBMITTED",
      occurredAt: "2026-07-13T08:58:02.000Z",
      source: "KEEPER",
      detail:
        "HarborRedeemer.executeDefault sent with the finalized FDC proof.",
    },
    {
      status: "RECOVERED",
      occurredAt: "2026-07-13T09:02:14.000Z",
      source: "KEEPER",
      detail:
        "AssetManager confirmed the default; collateral paid to the redeemer.",
    },
  ],
  xrplReceipts: [],
  fdcRequests: [
    {
      fdcRequestId: "fdc_38216902_1",
      redemptionRequestId: "38216902",
      attestationType: HARNESS_ATTESTATION_TYPE,
      sourceId: HARNESS_SOURCE_ID,
      requestBody:
        "0x0000000000000000000000000000000000000000000000000000000000000020",
      requestHash: HARNESS_REQUEST_HASH,
      status: "PROOF_READY",
      votingRoundId: "12",
      createdAt: "2026-07-13T08:22:45.000Z",
      updatedAt: "2026-07-13T08:41:33.000Z",
    },
  ],
  fdcProofs: [
    {
      fdcProofId: "proof_38216902_1",
      fdcRequestId: "fdc_38216902_1",
      redemptionRequestId: "38216902",
      requestHash: HARNESS_REQUEST_HASH,
      responseBody: HARNESS_RESPONSE_BODY,
      merkleProof: HARNESS_MERKLE_PROOF,
      votingRoundId: "12",
      createdAt: "2026-07-13T08:41:33.000Z",
    },
  ],
  defaultTransactionHash: HARNESS_DEFAULT_TX_HASH,
  generatedAt: "2026-07-13T09:03:40.000Z",
};

/** Redeem-by-tag (WITH_TAG) SETTLED redemption — destination tag lane. */
export const WITH_TAG_SETTLED_RESPONSE: GetRedemptionResponse = {
  redemption: {
    requestId: "38220471",
    assetManagerAddress: FXRP_ASSET_MANAGER_ADDRESS,
    status: "SETTLED",
    statusReason: null,
    redeemer: HARNESS_WALLET_ADDRESS,
    agentVault: "0xd5defe2c62d48788bb3889534fbfe7aea0602d64",
    agentDetails: agentDetails(
      "White-Knight",
      "Friendly liquidator for open beta",
    ),
    paymentAddress: HARNESS_XRPL_DESTINATION,
    redemptionKind: "WITH_TAG",
    destinationTag: WITH_TAG_DESTINATION,
    valueUBA: FXRP_VALUE_UBA,
    feeUBA: FXRP_FEE_UBA,
    paymentReference: HARNESS_PAYMENT_REFERENCE,
    transactionHash: HARNESS_REDEEM_WITH_TAG_TX_HASH,
    defaultTransactionHash: null,
    executor: HARBOR_REDEEMER_ADDRESS,
    executorFeeNatWei: EXECUTOR_FEE_NAT_WEI,
    firstUnderlyingBlock: "48216900",
    lastUnderlyingBlock: "48217540",
    lastUnderlyingTimestamp: "1752412638",
    createdAt: "2026-07-13T10:31:18.000Z",
    updatedAt: "2026-07-13T10:35:52.000Z",
  },
  statusTimeline: [
    {
      status: "REQUESTED",
      occurredAt: "2026-07-13T10:31:18.000Z",
      source: "REDEMPTION",
      detail: "Redemption requested with a destination tag (redeemWithTag).",
    },
    {
      status: "WATCHING",
      occurredAt: "2026-07-13T10:31:30.000Z",
      source: "KEEPER",
      detail:
        "Payment window opened; keeper watching for an XRPL payment carrying the required destination tag.",
    },
    {
      status: "SETTLED",
      occurredAt: "2026-07-13T10:35:52.000Z",
      source: "XRPL_OBSERVATION",
      detail:
        "Validated XRPL payment matched the destination, net amount, and required destination tag.",
    },
  ],
  xrplReceipts: [
    {
      observationId: "obs_38220471_1",
      redemptionRequestId: "38220471",
      transactionHash: HARNESS_XRPL_WITH_TAG_TX_HASH,
      sourceAddress: HARNESS_AGENT_SOURCE_ADDRESS,
      destinationAddress: HARNESS_XRPL_DESTINATION,
      deliveredAmountUBA: FXRP_NET_DELIVERED_UBA,
      feeDrops: "12",
      paymentReference: HARNESS_PAYMENT_REFERENCE,
      ledgerIndex: "49233015",
      closeTimestamp: "2026-07-13T10:35:49.000Z",
      validatedAt: "2026-07-13T10:35:51.000Z",
      destinationTag: WITH_TAG_DESTINATION,
      createdAt: "2026-07-13T10:35:51.000Z",
    },
  ],
  fdcRequests: [],
  fdcProofs: [],
  defaultTransactionHash: null,
  generatedAt: "2026-07-13T10:37:10.000Z",
};

export const SETTLED_VIEW_MODEL =
  deriveRedemptionStatusViewModel(SETTLED_RESPONSE);
export const RECOVERY_VIEW_MODEL =
  deriveRedemptionStatusViewModel(RECOVERY_RESPONSE);
export const RECOVERED_VIEW_MODEL =
  deriveRedemptionStatusViewModel(RECOVERED_RESPONSE);
export const WITH_TAG_SETTLED_VIEW_MODEL = deriveRedemptionStatusViewModel(
  WITH_TAG_SETTLED_RESPONSE,
);
