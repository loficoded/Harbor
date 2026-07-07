import type {
  AgentRecord,
  FdcProofRecord,
  FdcRequestRecord,
  IsoTimestamp,
  RedemptionRequest,
  XrplPaymentObservation,
} from "./domain.js";
import type { ServiceHealth } from "./health.js";
import type { JsonSafe } from "./json.js";

export type SerializedAgentRecord = JsonSafe<AgentRecord>;
export type SerializedRedemptionRequest = JsonSafe<RedemptionRequest>;
export type SerializedXrplPaymentObservation = JsonSafe<XrplPaymentObservation>;
export type SerializedFdcRequestRecord = JsonSafe<FdcRequestRecord>;
export type SerializedFdcProofRecord = JsonSafe<FdcProofRecord>;

export type GetAgentsResponse = Readonly<{
  agents: readonly SerializedAgentRecord[];
  generatedAt: IsoTimestamp;
}>;

export type GetRedemptionByIdResponse = Readonly<{
  redemption: SerializedRedemptionRequest;
  paymentObservations: readonly SerializedXrplPaymentObservation[];
  fdcRequests: readonly SerializedFdcRequestRecord[];
  fdcProofs: readonly SerializedFdcProofRecord[];
  generatedAt: IsoTimestamp;
}>;

export type GetHealthResponse = ServiceHealth;
