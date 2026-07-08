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
  score: AgentScore;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}>;

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

export type FdcRequestStatus = "PENDING" | "SUBMITTED" | "FINALIZED" | "FAILED";

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
