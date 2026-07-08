import {
  serializeBigints,
  type AgentAvailability,
  type EvmAddress,
  type IsoTimestamp,
} from "@harbor/shared";

import type { SqliteDatabase } from "../db/index.js";
import { upsertAgentReliabilityScore } from "../repositories/agentReliabilityScores.js";
import { listAgents, upsertAgent } from "../repositories/agents.js";
import type {
  AgentCollateralRatioSource,
  AgentReliabilityFtsoStatus,
  StoredAgentRecord,
  UpsertAgentReliabilityScoreInput,
} from "../repositories/types.js";
import {
  feedValueToNumber,
  readOptionalFtsoPriceSnapshot,
  type FtsoPriceSnapshot,
  type FtsoReadContractClient,
} from "./ftsoPrices.js";

export {
  defaultFtsoMaxAgeSeconds,
  flrUsdFtsoFeedId,
  readFtsoPriceSnapshot,
  readOptionalFtsoPriceSnapshot,
  unavailableFtsoPriceSnapshot,
  xrpUsdFtsoFeedId,
  type FtsoFeedId,
  type FtsoFeedName,
  type FtsoFeedValue,
  type FtsoPriceSnapshot,
  type FtsoReadContractClient,
} from "./ftsoPrices.js";

export const agentReliabilityFormulaVersion = "agent-reliability-mvp-v1";

const settlementMinimumSamples = 3;
const settlementFastSeconds = 60 * 60;
const settlementSlowSeconds = 24 * 60 * 60;
const collateralFloorBips = 12_000n;
const collateralFullBips = 20_000n;
const ubaDecimals = 6;
const natDecimals = 18;

export type RedemptionHistorySummary = Readonly<{
  successfulRedemptions: number;
  defaultedRedemptions: number;
  averageSettlementSeconds: number | null;
}>;

export type AgentReliabilityScoreInput = Readonly<{
  agentVault: EvmAddress;
  history: RedemptionHistorySummary;
  availability: AgentAvailability;
  availableLots: bigint;
  collateralRatioBips: bigint | null;
  collateralRatioSource: AgentCollateralRatioSource;
  priceDerivedCollateralRatioBips: bigint | null;
  ftsoSnapshot: FtsoPriceSnapshot;
  refreshedAt?: IsoTimestamp;
}>;

export type AgentReliabilityScoreRefreshInput = Readonly<{
  database: SqliteDatabase;
  ftsoClient?: FtsoReadContractClient | undefined;
  ftsoV2Address?: EvmAddress | undefined;
  refreshedAt?: IsoTimestamp | undefined;
  maxFtsoAgeSeconds?: number | undefined;
}>;

export type AgentReliabilityScoreRefreshSummary = Readonly<{
  refreshedAt: IsoTimestamp;
  formulaVersion: string;
  agentsScored: number;
  scoresPersisted: number;
  ftsoStatus: AgentReliabilityFtsoStatus;
  ftsoTimestamp: string | null;
}>;

type RedemptionHistoryRow = Readonly<{
  agent_vault: string;
  successful_redemptions: number;
  defaulted_redemptions: number;
  average_settlement_seconds: number | null;
}>;

type CollateralSelection = Readonly<{
  collateralRatioBips: bigint | null;
  collateralRatioSource: AgentCollateralRatioSource;
  priceDerivedCollateralRatioBips: bigint | null;
}>;

export function calculateAgentReliabilityScore(
  input: AgentReliabilityScoreInput,
): UpsertAgentReliabilityScoreInput {
  const refreshedAt = input.refreshedAt ?? new Date().toISOString();
  const successfulRedemptions = nonNegativeSafeInteger(
    input.history.successfulRedemptions,
    "successfulRedemptions",
  );
  const defaultedRedemptions = nonNegativeSafeInteger(
    input.history.defaultedRedemptions,
    "defaultedRedemptions",
  );
  const averageSettlementSeconds =
    input.history.averageSettlementSeconds === null
      ? null
      : nonNegativeSafeInteger(
          input.history.averageSettlementSeconds,
          "averageSettlementSeconds",
        );
  const totalTerminalRedemptions = nonNegativeSafeInteger(
    successfulRedemptions + defaultedRedemptions,
    "totalTerminalRedemptions",
  );
  const fulfillmentRate =
    totalTerminalRedemptions === 0
      ? null
      : successfulRedemptions / totalTerminalRedemptions;
  const fulfillmentScore =
    fulfillmentRate === null ? 22.5 : fulfillmentRate * 45;
  const settlementTimeScore = calculateSettlementTimeScore(
    successfulRedemptions,
    averageSettlementSeconds,
  );
  const defaultPenalty = Math.min(defaultedRedemptions * 5, 20);
  const availabilityScore = calculateAvailabilityScore(
    input.availability,
    input.availableLots,
  );
  const collateralScore = calculateCollateralScore(input.collateralRatioBips);
  const score = clampScore(
    fulfillmentScore +
      settlementTimeScore +
      availabilityScore +
      collateralScore -
      defaultPenalty,
  );
  const components = {
    formulaVersion: agentReliabilityFormulaVersion,
    weights: {
      fulfillmentScoreMax: 45,
      settlementTimeScoreMax: 15,
      availabilityScoreMax: 20,
      collateralScoreMax: 20,
      defaultPenaltyMax: 20,
    },
    thresholds: {
      settlementMinimumSamples,
      settlementFastSeconds,
      settlementSlowSeconds,
      collateralFloorBips,
      collateralFullBips,
    },
    history: {
      successfulRedemptions,
      defaultedRedemptions,
      totalTerminalRedemptions,
      fulfillmentRate,
      averageSettlementSeconds,
    },
    inventory: {
      availability: input.availability,
      availableLots: input.availableLots,
      collateralRatioBips: input.collateralRatioBips,
      collateralRatioSource: input.collateralRatioSource,
      priceDerivedCollateralRatioBips: input.priceDerivedCollateralRatioBips,
    },
    scores: {
      fulfillmentScore: roundScore(fulfillmentScore),
      settlementTimeScore: roundScore(settlementTimeScore),
      defaultPenalty: roundScore(defaultPenalty),
      availabilityScore: roundScore(availabilityScore),
      collateralScore: roundScore(collateralScore),
      finalScore: score,
    },
    ftso: serializeFtsoSnapshot(input.ftsoSnapshot),
  };

  return {
    agentVault: input.agentVault,
    score,
    formulaVersion: agentReliabilityFormulaVersion,
    fulfillmentRate:
      fulfillmentRate === null ? null : roundScore(fulfillmentRate),
    fulfillmentScore: roundScore(fulfillmentScore),
    settlementTimeScore: roundScore(settlementTimeScore),
    defaultPenalty: roundScore(defaultPenalty),
    availabilityScore: roundScore(availabilityScore),
    collateralScore: roundScore(collateralScore),
    successfulRedemptions,
    defaultedRedemptions,
    totalTerminalRedemptions,
    averageSettlementSeconds,
    availability: input.availability,
    availableLots: input.availableLots,
    collateralRatioBips: input.collateralRatioBips,
    collateralRatioSource: input.collateralRatioSource,
    ftsoStatus: input.ftsoSnapshot.status,
    ftsoXrpUsdPrice: input.ftsoSnapshot.xrpUsd?.price ?? null,
    ftsoFlrUsdPrice: input.ftsoSnapshot.flrUsd?.price ?? null,
    ftsoTimestamp:
      input.ftsoSnapshot.timestamp === null
        ? null
        : input.ftsoSnapshot.timestamp.toString(),
    ftsoError: input.ftsoSnapshot.error,
    componentsJson: stringifyJsonSafe(components),
    createdAt: refreshedAt,
    updatedAt: refreshedAt,
  };
}

export async function refreshAgentReliabilityScores(
  input: AgentReliabilityScoreRefreshInput,
): Promise<AgentReliabilityScoreRefreshSummary> {
  const refreshedAt = input.refreshedAt ?? new Date().toISOString();
  const ftsoSnapshot = await readOptionalFtsoPriceSnapshot({
    ftsoClient: input.ftsoClient,
    ftsoV2Address: input.ftsoV2Address,
    readAt: refreshedAt,
    maxAgeSeconds: input.maxFtsoAgeSeconds,
  });
  const agents = listAgents(input.database);
  const historyByAgent = readRedemptionHistoryByAgent(input.database);
  const scores = agents.map((agent) => {
    const collateral = selectCollateralRatio(agent, ftsoSnapshot);

    return calculateAgentReliabilityScore({
      agentVault: agent.agentVault,
      history: historyByAgent.get(agent.agentVault) ?? emptyHistory(),
      availability: agent.availability,
      availableLots: agent.availableLots,
      collateralRatioBips: collateral.collateralRatioBips,
      collateralRatioSource: collateral.collateralRatioSource,
      priceDerivedCollateralRatioBips:
        collateral.priceDerivedCollateralRatioBips,
      ftsoSnapshot,
      refreshedAt,
    });
  });
  const persistScores = input.database.transaction(
    (records: readonly UpsertAgentReliabilityScoreInput[]) => {
      for (const record of records) {
        upsertAgentReliabilityScore(input.database, record);
        upsertAgent(input.database, {
          agentVault: record.agentVault,
          score: {
            agentVault: record.agentVault,
            score: record.score,
            successfulRedemptions: record.successfulRedemptions,
            failedRedemptions: record.defaultedRedemptions,
            averagePaymentSeconds: record.averageSettlementSeconds,
            updatedAt: refreshedAt,
          },
          updatedAt: refreshedAt,
        });
      }
    },
  );

  persistScores(scores);

  return {
    refreshedAt,
    formulaVersion: agentReliabilityFormulaVersion,
    agentsScored: scores.length,
    scoresPersisted: scores.length,
    ftsoStatus: ftsoSnapshot.status,
    ftsoTimestamp:
      ftsoSnapshot.timestamp === null
        ? null
        : ftsoSnapshot.timestamp.toString(),
  };
}

function emptyHistory(): RedemptionHistorySummary {
  return {
    successfulRedemptions: 0,
    defaultedRedemptions: 0,
    averageSettlementSeconds: null,
  };
}

function readRedemptionHistoryByAgent(
  database: SqliteDatabase,
): ReadonlyMap<EvmAddress, RedemptionHistorySummary> {
  const rows = database
    .prepare<[], RedemptionHistoryRow>(
      `
SELECT
  agent_vault,
  SUM(CASE WHEN status = 'SETTLED' THEN 1 ELSE 0 END) AS successful_redemptions,
  SUM(CASE WHEN status = 'RECOVERED' THEN 1 ELSE 0 END) AS defaulted_redemptions,
  ROUND(AVG(
    CASE
      WHEN status = 'SETTLED'
        AND julianday(updated_at) IS NOT NULL
        AND julianday(created_at) IS NOT NULL
        AND julianday(updated_at) >= julianday(created_at)
      THEN (julianday(updated_at) - julianday(created_at)) * 86400.0
      ELSE NULL
    END
  )) AS average_settlement_seconds
FROM redemptions
WHERE status IN ('SETTLED', 'RECOVERED')
GROUP BY agent_vault
`,
    )
    .all();
  const historyByAgent = new Map<EvmAddress, RedemptionHistorySummary>();

  for (const row of rows) {
    historyByAgent.set(row.agent_vault as EvmAddress, {
      successfulRedemptions: row.successful_redemptions,
      defaultedRedemptions: row.defaulted_redemptions,
      averageSettlementSeconds: row.average_settlement_seconds,
    });
  }

  return historyByAgent;
}

function selectCollateralRatio(
  agent: StoredAgentRecord,
  ftsoSnapshot: FtsoPriceSnapshot,
): CollateralSelection {
  const collateralMetadata = parseJsonObject(agent.collateralMetadataJson);
  const inventoryRatio = selectInventoryCollateralRatioBips(collateralMetadata);
  const priceDerivedRatio = derivePriceCollateralRatioBips(
    collateralMetadata,
    ftsoSnapshot,
  );

  if (inventoryRatio !== null) {
    return {
      collateralRatioBips: inventoryRatio,
      collateralRatioSource: "INVENTORY",
      priceDerivedCollateralRatioBips: priceDerivedRatio,
    };
  }

  if (priceDerivedRatio !== null) {
    return {
      collateralRatioBips: priceDerivedRatio,
      collateralRatioSource: "FTSO_DERIVED",
      priceDerivedCollateralRatioBips: priceDerivedRatio,
    };
  }

  return {
    collateralRatioBips: null,
    collateralRatioSource: "UNAVAILABLE",
    priceDerivedCollateralRatioBips: priceDerivedRatio,
  };
}

function selectInventoryCollateralRatioBips(
  collateralMetadata: Readonly<Record<string, unknown>> | null,
): bigint | null {
  const currentRatios = [
    optionalBigintField(collateralMetadata, "vaultCollateralRatioBIPS"),
    optionalBigintField(collateralMetadata, "poolCollateralRatioBIPS"),
  ].filter(isBigint);

  if (currentRatios.length > 0) {
    return minBigint(currentRatios);
  }

  const mintingRatios = [
    optionalBigintField(collateralMetadata, "mintingVaultCollateralRatioBIPS"),
    optionalBigintField(collateralMetadata, "mintingPoolCollateralRatioBIPS"),
  ].filter(isBigint);

  return mintingRatios.length === 0 ? null : minBigint(mintingRatios);
}

function derivePriceCollateralRatioBips(
  collateralMetadata: Readonly<Record<string, unknown>> | null,
  ftsoSnapshot: FtsoPriceSnapshot,
): bigint | null {
  if (
    collateralMetadata === null ||
    ftsoSnapshot.status !== "AVAILABLE" ||
    ftsoSnapshot.flrUsd === null ||
    ftsoSnapshot.xrpUsd === null
  ) {
    return null;
  }

  const totalPoolCollateralNATWei = optionalBigintField(
    collateralMetadata,
    "totalPoolCollateralNATWei",
  );
  const liabilityUBA = sumBigints([
    optionalBigintField(collateralMetadata, "mintedUBA"),
    optionalBigintField(collateralMetadata, "reservedUBA"),
    optionalBigintField(collateralMetadata, "redeemingUBA"),
    optionalBigintField(collateralMetadata, "poolRedeemingUBA"),
  ]);

  if (
    totalPoolCollateralNATWei === null ||
    totalPoolCollateralNATWei <= 0n ||
    liabilityUBA <= 0n
  ) {
    return null;
  }

  const poolCollateralNat = scaledBigintToNumber(
    totalPoolCollateralNATWei,
    natDecimals,
  );
  const liabilityXrp = scaledBigintToNumber(liabilityUBA, ubaDecimals);
  const flrUsd = feedValueToNumber(ftsoSnapshot.flrUsd);
  const xrpUsd = feedValueToNumber(ftsoSnapshot.xrpUsd);

  if (
    poolCollateralNat === null ||
    liabilityXrp === null ||
    flrUsd === null ||
    xrpUsd === null ||
    liabilityXrp <= 0 ||
    xrpUsd <= 0
  ) {
    return null;
  }

  const collateralValueUsd = poolCollateralNat * flrUsd;
  const liabilityValueUsd = liabilityXrp * xrpUsd;
  const ratioBips = (collateralValueUsd / liabilityValueUsd) * 10_000;

  if (!Number.isFinite(ratioBips) || ratioBips < 0) {
    return null;
  }

  return BigInt(Math.round(ratioBips));
}

function calculateAvailabilityScore(
  availability: AgentAvailability,
  availableLots: bigint,
): number {
  if (availability === "AVAILABLE") {
    return availableLots > 0n ? 20 : 8;
  }

  if (availability === "UNKNOWN") {
    return 5;
  }

  return 0;
}

function calculateSettlementTimeScore(
  successfulRedemptions: number,
  averageSettlementSeconds: number | null,
): number {
  if (
    successfulRedemptions < settlementMinimumSamples ||
    averageSettlementSeconds === null
  ) {
    return 7.5;
  }

  if (averageSettlementSeconds <= settlementFastSeconds) {
    return 15;
  }

  if (averageSettlementSeconds >= settlementSlowSeconds) {
    return 0;
  }

  return (
    ((settlementSlowSeconds - averageSettlementSeconds) /
      (settlementSlowSeconds - settlementFastSeconds)) *
    15
  );
}

function calculateCollateralScore(collateralRatioBips: bigint | null): number {
  if (collateralRatioBips === null) {
    return 5;
  }

  if (collateralRatioBips <= collateralFloorBips) {
    return 0;
  }

  if (collateralRatioBips >= collateralFullBips) {
    return 20;
  }

  return (
    (Number(collateralRatioBips - collateralFloorBips) /
      Number(collateralFullBips - collateralFloorBips)) *
    20
  );
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return roundScore(Math.max(0, Math.min(100, value)));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function integerToBigint(value: unknown, fieldName: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value);
  }

  throw new Error(`${fieldName} must be an integer`);
}

function nonNegativeSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }

  return value;
}

function parseJsonObject(
  value: string | null,
): Readonly<Record<string, unknown>> | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as Readonly<Record<string, unknown>>;
    }

    return null;
  } catch {
    return null;
  }
}

function optionalBigintField(
  record: Readonly<Record<string, unknown>> | null,
  fieldName: string,
): bigint | null {
  if (record === null) {
    return null;
  }

  const value = record[fieldName];

  if (value === null || value === undefined) {
    return null;
  }

  return integerToBigint(value, fieldName);
}

function isBigint(value: bigint | null): value is bigint {
  return value !== null;
}

function minBigint(values: readonly bigint[]): bigint {
  const firstValue = values[0];

  if (firstValue === undefined) {
    throw new Error("Cannot calculate bigint minimum for an empty array");
  }

  return values.reduce(
    (minimum, value) => (value < minimum ? value : minimum),
    firstValue,
  );
}

function sumBigints(values: readonly (bigint | null)[]): bigint {
  return values.reduce<bigint>(
    (sum, value) => (value === null ? sum : sum + value),
    0n,
  );
}

function scaledBigintToNumber(value: bigint, decimals: number): number | null {
  const scaledValue = Number(value) / 10 ** decimals;
  return Number.isFinite(scaledValue) ? scaledValue : null;
}

function serializeFtsoSnapshot(snapshot: FtsoPriceSnapshot) {
  return {
    status: snapshot.status,
    xrpUsd: snapshot.xrpUsd,
    flrUsd: snapshot.flrUsd,
    timestamp: snapshot.timestamp,
    readAt: snapshot.readAt,
    error: snapshot.error,
  };
}

function stringifyJsonSafe(value: unknown): string {
  const serialized = JSON.stringify(serializeBigints(value));

  if (serialized === undefined) {
    throw new Error(
      "Agent reliability score components could not be serialized",
    );
  }

  return serialized;
}
