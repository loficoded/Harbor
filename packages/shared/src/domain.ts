import type {
  Bytes32,
  EvmAddress,
  HexString,
  RedemptionRequestId,
  TransactionHash,
} from "./normalize.js";

export type IsoTimestamp = string;
export type XrplAddress = string;

export const redemptionStatuses = [
  "REQUESTED",
  "WATCHING",
  "SETTLED",
  "WINDOW_EXPIRED",
  "REQUEST_PROOF",
  "PROOF_READY",
  "DEFAULT_SUBMITTED",
  "RECOVERED",
  "FAILED",
  "UNKNOWN",
] as const;

export type RedemptionStatus = (typeof redemptionStatuses)[number];

export const terminalRedemptionStatuses = [
  "SETTLED",
  "RECOVERED",
  "FAILED",
] as const satisfies readonly RedemptionStatus[];

export const redemptionStatusTransitions = {
  REQUESTED: ["WATCHING", "REQUEST_PROOF", "WINDOW_EXPIRED", "FAILED"],
  WATCHING: ["SETTLED", "REQUEST_PROOF", "WINDOW_EXPIRED", "FAILED"],
  SETTLED: [],
  WINDOW_EXPIRED: ["REQUEST_PROOF", "FAILED"],
  REQUEST_PROOF: ["PROOF_READY", "FAILED"],
  PROOF_READY: ["DEFAULT_SUBMITTED", "RECOVERED", "FAILED"],
  DEFAULT_SUBMITTED: ["RECOVERED", "FAILED"],
  RECOVERED: [],
  FAILED: [],
  UNKNOWN: [
    "REQUESTED",
    "WATCHING",
    "SETTLED",
    "WINDOW_EXPIRED",
    "REQUEST_PROOF",
    "PROOF_READY",
    "DEFAULT_SUBMITTED",
    "RECOVERED",
    "FAILED",
  ],
} as const satisfies Record<RedemptionStatus, readonly RedemptionStatus[]>;

const redemptionStatusSet: ReadonlySet<string> = new Set(redemptionStatuses);

export function isRedemptionStatus(value: string): value is RedemptionStatus {
  return redemptionStatusSet.has(value);
}

export type RedemptionRequest = Readonly<{
  requestId: RedemptionRequestId;
  transactionHash: TransactionHash | null;
  redeemer: EvmAddress;
  agentVault: EvmAddress;
  paymentAddress: XrplAddress;
  valueUBA: bigint;
  feeUBA: bigint;
  paymentReference: Bytes32;
  firstUnderlyingBlock: bigint;
  lastUnderlyingBlock: bigint;
  lastUnderlyingTimestamp: bigint;
  executor: EvmAddress | null;
  executorFeeNatWei: bigint;
  status: RedemptionStatus;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}>;

export type AgentAvailability = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";

/**
 * Official FAssets agent details, as published by the agent's owner in the
 * `AgentOwnerRegistry` contract and keyed by the owner's management address.
 * These are the fields defined by the Flare FAssets specification:
 * https://dev.flare.network/fassets/developer-guides/fassets-agent-details
 *
 * Every field is independently optional: an agent owner may set any subset of
 * them (or none at all). A field is `null` when the registry has no value for
 * it (the on-chain getter returns an empty string), when the agent has no
 * resolvable management address, or when the registry could not be read. This
 * lets every consumer fall back to existing behavior (e.g. showing the vault
 * address) without any field ever being `undefined`.
 */
export type AgentDetails = Readonly<{
  /** Official display name, or `null` when unset/unavailable. */
  name: string | null;
  /** Longer description, or `null` when unset/unavailable. */
  description: string | null;
  /** URL to the agent's icon/logo image, or `null` when unset/unavailable. */
  iconUrl: string | null;
  /** URL to the agent's terms-of-use page, or `null` when unset/unavailable. */
  termsOfUseUrl: string | null;
}>;

/**
 * The canonical "no official details" value. Used as the fallback whenever an
 * agent has not published metadata, has no management address, or the registry
 * read was skipped/failed — keeping `AgentDetails` always present (never
 * `undefined`) so consumers only branch on individual `null` fields.
 */
export const emptyAgentDetails: AgentDetails = {
  name: null,
  description: null,
  iconUrl: null,
  termsOfUseUrl: null,
};

/**
 * Normalize a raw on-chain string (as returned by an `AgentOwnerRegistry`
 * getter) into an `AgentDetails` field value: trims surrounding whitespace and
 * collapses an empty string to `null`, so "unset" and "blank" are treated
 * identically and trigger the documented fallback behavior. A non-string input
 * (e.g. a failed/absent read) also normalizes to `null`.
 */
export function normalizeAgentDetailField(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Whether an `AgentDetails` carries any official metadata at all. `false` means
 * every field is `null`, i.e. the consumer should fall back to prior behavior.
 */
export function hasAgentDetails(details: AgentDetails): boolean {
  return (
    details.name !== null ||
    details.description !== null ||
    details.iconUrl !== null ||
    details.termsOfUseUrl !== null
  );
}

export type AgentScore = Readonly<{
  agentVault: EvmAddress;
  score: number;
  successfulRedemptions: number;
  failedRedemptions: number;
  averagePaymentSeconds: number | null;
  updatedAt: IsoTimestamp;
}>;

export type AgentRecord = Readonly<{
  agentVault: EvmAddress;
  owner: EvmAddress | null;
  paymentAddress: XrplAddress | null;
  availability: AgentAvailability;
  redemptionFeeBips: number | null;
  availableLots: bigint;
  /**
   * Official agent details published by the owner in the `AgentOwnerRegistry`
   * (name, description, icon, terms of use). Always present; individual fields
   * are `null` when unavailable so rendering can fall back to the vault
   * address without functional impact.
   */
  details: AgentDetails;
  score: AgentScore;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}>;

/**
 * Freshness of the FTSO price feeds used when deriving an agent's collateral
 * ratio for reliability scoring. `STALE` means a price was returned but is
 * older than the accepted window; `FAILED` means the feed could not be read.
 */
export type AgentReliabilityFtsoStatus =
  "AVAILABLE" | "UNAVAILABLE" | "STALE" | "FAILED";

/**
 * How an agent's collateral ratio was determined: read directly from indexed
 * inventory, derived from FTSO prices, or unavailable for scoring.
 */
export type AgentCollateralRatioSource =
  "INVENTORY" | "FTSO_DERIVED" | "UNAVAILABLE";

export type XrplPaymentObservation = Readonly<{
  observationId: string;
  redemptionRequestId: RedemptionRequestId;
  transactionHash: TransactionHash;
  sourceAddress: XrplAddress;
  destinationAddress: XrplAddress;
  deliveredAmountUBA: bigint;
  feeDrops: bigint;
  paymentReference: Bytes32;
  ledgerIndex: bigint;
  closeTimestamp: IsoTimestamp;
  validatedAt: IsoTimestamp;
  createdAt: IsoTimestamp;
}>;

export type FdcRequestStatus =
  "PENDING" | "SUBMITTED" | "FINALIZED" | "PROOF_READY" | "FAILED";

export type FdcRequestRecord = Readonly<{
  fdcRequestId: string;
  redemptionRequestId: RedemptionRequestId;
  attestationType: Bytes32;
  sourceId: Bytes32;
  requestBody: HexString;
  requestHash: Bytes32;
  status: FdcRequestStatus;
  votingRoundId: bigint | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}>;

export type FdcProofRecord = Readonly<{
  fdcProofId: string;
  fdcRequestId: string;
  redemptionRequestId: RedemptionRequestId;
  requestHash: Bytes32;
  responseBody: HexString;
  merkleProof: readonly Bytes32[];
  votingRoundId: bigint;
  createdAt: IsoTimestamp;
}>;
