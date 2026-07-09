import type {
  AgentAvailability,
  AgentCollateralRatioSource,
  AgentReliabilityFtsoStatus,
  FdcProofRecord,
  FdcRequestRecord,
  IsoTimestamp,
  RedemptionStatus,
  XrplAddress,
  XrplPaymentObservation,
} from "./domain.js";
import type { HealthReport } from "./health.js";
import type { JsonSafe, JsonValue } from "./json.js";
import type {
  Bytes32,
  EvmAddress,
  RedemptionRequestId,
  TransactionHash,
} from "./normalize.js";

/**
 * Stable shape for every non-2xx JSON response. `code` is a machine-readable
 * identifier, `message` is human-readable, `requestId` correlates the response
 * with a server request-log line, and `details` carries optional structured
 * context (validation issues, and similar).
 */
export type ApiErrorBody = Readonly<{
  code: string;
  message: string;
  requestId: string;
  details: JsonValue | null;
}>;

export type ApiErrorResponse = Readonly<{
  error: ApiErrorBody;
}>;

export type GetHealthResponse = HealthReport;

/**
 * Ranked reliability view for a single agent, projected from the Prompt #10
 * scoring record. `scoreIsHeuristic` is always `true` in the MVP: the score is
 * a transparent heuristic, not a guarantee. `availableLots` and
 * `collateralRatioBips` are `bigint` here and are stringified on the wire.
 */
export type AgentScoreView = Readonly<{
  agentVault: EvmAddress;
  score: number;
  scoreIsHeuristic: true;
  formulaVersion: string;
  fulfillmentRate: number | null;
  fulfillmentScore: number;
  settlementTimeScore: number;
  defaultPenalty: number;
  availabilityScore: number;
  collateralScore: number;
  successfulRedemptions: number;
  defaultedRedemptions: number;
  totalTerminalRedemptions: number;
  averageSettlementSeconds: number | null;
  availability: AgentAvailability;
  availableLots: bigint;
  collateralRatioBips: bigint | null;
  collateralRatioSource: AgentCollateralRatioSource;
  /**
   * Freshness of the FTSO price feeds behind the scoring snapshot. Surfaced so
   * clients can flag an FTSO-derived collateral ratio as `STALE`/`FAILED`
   * rather than presenting a possibly-outdated value as current. This projects
   * the already-persisted scoring field; it introduces no new scoring logic.
   */
  ftsoStatus: AgentReliabilityFtsoStatus;
  updatedAt: IsoTimestamp;
}>;

export type AgentsResponseData = Readonly<{
  asset: string;
  scoreIsHeuristic: true;
  agents: readonly AgentScoreView[];
  generatedAt: IsoTimestamp;
}>;

export type SerializedAgentScoreView = JsonSafe<AgentScoreView>;
export type GetAgentsResponse = JsonSafe<AgentsResponseData>;

/**
 * Full redemption row exposed by the detail endpoint. Extends the on-chain
 * request with the backend's tracked settlement/recovery fields
 * (`statusReason`, `defaultTransactionHash`).
 */
export type RedemptionDetail = Readonly<{
  requestId: RedemptionRequestId;
  assetManagerAddress: EvmAddress;
  status: RedemptionStatus;
  statusReason: string | null;
  redeemer: EvmAddress;
  agentVault: EvmAddress;
  paymentAddress: XrplAddress;
  valueUBA: bigint;
  feeUBA: bigint;
  paymentReference: Bytes32;
  transactionHash: TransactionHash | null;
  defaultTransactionHash: TransactionHash | null;
  executor: EvmAddress | null;
  executorFeeNatWei: bigint;
  firstUnderlyingBlock: bigint;
  lastUnderlyingBlock: bigint;
  lastUnderlyingTimestamp: bigint;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}>;

/** Which stored record produced a given timeline milestone. */
export type RedemptionTimelineSource =
  "REDEMPTION" | "XRPL_OBSERVATION" | "FDC_REQUEST" | "FDC_PROOF" | "KEEPER";

/**
 * One milestone in a redemption's lifecycle, derived from concrete stored
 * evidence and ordered oldest-first. The final entry always reflects the
 * redemption's current status.
 */
export type RedemptionTimelineEntry = Readonly<{
  status: RedemptionStatus;
  occurredAt: IsoTimestamp;
  source: RedemptionTimelineSource;
  detail: string | null;
}>;

export type RedemptionResponseData = Readonly<{
  redemption: RedemptionDetail;
  statusTimeline: readonly RedemptionTimelineEntry[];
  xrplReceipts: readonly XrplPaymentObservation[];
  fdcRequests: readonly FdcRequestRecord[];
  fdcProofs: readonly FdcProofRecord[];
  defaultTransactionHash: TransactionHash | null;
  generatedAt: IsoTimestamp;
}>;

export type SerializedRedemptionDetail = JsonSafe<RedemptionDetail>;
export type SerializedXrplPaymentObservation = JsonSafe<XrplPaymentObservation>;
export type SerializedFdcRequestRecord = JsonSafe<FdcRequestRecord>;
export type SerializedFdcProofRecord = JsonSafe<FdcProofRecord>;
export type GetRedemptionResponse = JsonSafe<RedemptionResponseData>;
