import {
  parseSerializedBigint,
  serializeBigint,
  type EvmAddress,
} from "@harbor/shared";

import type { SqliteDatabase } from "../db/index.js";
import { nowIso, optionalRow, requireRow } from "./common.js";
import type {
  StoredAgentReliabilityScoreRecord,
  UpsertAgentReliabilityScoreInput,
} from "./types.js";

type AgentReliabilityScoreRow = Readonly<{
  agent_vault: string;
  score: number;
  formula_version: string;
  fulfillment_rate: number | null;
  fulfillment_score: number;
  settlement_time_score: number;
  default_penalty: number;
  availability_score: number;
  collateral_score: number;
  successful_redemptions: number;
  defaulted_redemptions: number;
  total_terminal_redemptions: number;
  average_settlement_seconds: number | null;
  availability: StoredAgentReliabilityScoreRecord["availability"];
  available_lots: string;
  collateral_ratio_bips: string | null;
  collateral_ratio_source: StoredAgentReliabilityScoreRecord["collateralRatioSource"];
  ftso_status: StoredAgentReliabilityScoreRecord["ftsoStatus"];
  ftso_xrp_usd_price: string | null;
  ftso_flr_usd_price: string | null;
  ftso_timestamp: string | null;
  ftso_error: string | null;
  components_json: string;
  created_at: string;
  updated_at: string;
}>;

function mapAgentReliabilityScoreRow(
  row: AgentReliabilityScoreRow,
): StoredAgentReliabilityScoreRecord {
  return {
    agentVault: row.agent_vault as EvmAddress,
    score: row.score,
    formulaVersion: row.formula_version,
    fulfillmentRate: row.fulfillment_rate,
    fulfillmentScore: row.fulfillment_score,
    settlementTimeScore: row.settlement_time_score,
    defaultPenalty: row.default_penalty,
    availabilityScore: row.availability_score,
    collateralScore: row.collateral_score,
    successfulRedemptions: row.successful_redemptions,
    defaultedRedemptions: row.defaulted_redemptions,
    totalTerminalRedemptions: row.total_terminal_redemptions,
    averageSettlementSeconds: row.average_settlement_seconds,
    availability: row.availability,
    availableLots: parseSerializedBigint(row.available_lots),
    collateralRatioBips:
      row.collateral_ratio_bips === null
        ? null
        : parseSerializedBigint(row.collateral_ratio_bips),
    collateralRatioSource: row.collateral_ratio_source,
    ftsoStatus: row.ftso_status,
    ftsoXrpUsdPrice: row.ftso_xrp_usd_price,
    ftsoFlrUsdPrice: row.ftso_flr_usd_price,
    ftsoTimestamp: row.ftso_timestamp,
    ftsoError: row.ftso_error,
    componentsJson: row.components_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertAgentReliabilityScore(
  database: SqliteDatabase,
  input: UpsertAgentReliabilityScoreInput,
): StoredAgentReliabilityScoreRecord {
  const createdAt = input.createdAt ?? nowIso();
  const updatedAt = input.updatedAt ?? createdAt;

  database
    .prepare(
      `
INSERT INTO agent_reliability_scores (
  agent_vault,
  score,
  formula_version,
  fulfillment_rate,
  fulfillment_score,
  settlement_time_score,
  default_penalty,
  availability_score,
  collateral_score,
  successful_redemptions,
  defaulted_redemptions,
  total_terminal_redemptions,
  average_settlement_seconds,
  availability,
  available_lots,
  collateral_ratio_bips,
  collateral_ratio_source,
  ftso_status,
  ftso_xrp_usd_price,
  ftso_flr_usd_price,
  ftso_timestamp,
  ftso_error,
  components_json,
  created_at,
  updated_at
) VALUES (
  @agentVault,
  @score,
  @formulaVersion,
  @fulfillmentRate,
  @fulfillmentScore,
  @settlementTimeScore,
  @defaultPenalty,
  @availabilityScore,
  @collateralScore,
  @successfulRedemptions,
  @defaultedRedemptions,
  @totalTerminalRedemptions,
  @averageSettlementSeconds,
  @availability,
  @availableLots,
  @collateralRatioBips,
  @collateralRatioSource,
  @ftsoStatus,
  @ftsoXrpUsdPrice,
  @ftsoFlrUsdPrice,
  @ftsoTimestamp,
  @ftsoError,
  @componentsJson,
  @createdAt,
  @updatedAt
)
ON CONFLICT(agent_vault) DO UPDATE SET
  score = excluded.score,
  formula_version = excluded.formula_version,
  fulfillment_rate = excluded.fulfillment_rate,
  fulfillment_score = excluded.fulfillment_score,
  settlement_time_score = excluded.settlement_time_score,
  default_penalty = excluded.default_penalty,
  availability_score = excluded.availability_score,
  collateral_score = excluded.collateral_score,
  successful_redemptions = excluded.successful_redemptions,
  defaulted_redemptions = excluded.defaulted_redemptions,
  total_terminal_redemptions = excluded.total_terminal_redemptions,
  average_settlement_seconds = excluded.average_settlement_seconds,
  availability = excluded.availability,
  available_lots = excluded.available_lots,
  collateral_ratio_bips = excluded.collateral_ratio_bips,
  collateral_ratio_source = excluded.collateral_ratio_source,
  ftso_status = excluded.ftso_status,
  ftso_xrp_usd_price = excluded.ftso_xrp_usd_price,
  ftso_flr_usd_price = excluded.ftso_flr_usd_price,
  ftso_timestamp = excluded.ftso_timestamp,
  ftso_error = excluded.ftso_error,
  components_json = excluded.components_json,
  updated_at = excluded.updated_at
`,
    )
    .run({
      agentVault: input.agentVault,
      score: input.score,
      formulaVersion: input.formulaVersion,
      fulfillmentRate: input.fulfillmentRate,
      fulfillmentScore: input.fulfillmentScore,
      settlementTimeScore: input.settlementTimeScore,
      defaultPenalty: input.defaultPenalty,
      availabilityScore: input.availabilityScore,
      collateralScore: input.collateralScore,
      successfulRedemptions: input.successfulRedemptions,
      defaultedRedemptions: input.defaultedRedemptions,
      totalTerminalRedemptions: input.totalTerminalRedemptions,
      averageSettlementSeconds: input.averageSettlementSeconds,
      availability: input.availability,
      availableLots: serializeBigint(input.availableLots),
      collateralRatioBips:
        input.collateralRatioBips === null
          ? null
          : serializeBigint(input.collateralRatioBips),
      collateralRatioSource: input.collateralRatioSource,
      ftsoStatus: input.ftsoStatus,
      ftsoXrpUsdPrice: input.ftsoXrpUsdPrice,
      ftsoFlrUsdPrice: input.ftsoFlrUsdPrice,
      ftsoTimestamp: input.ftsoTimestamp,
      ftsoError: input.ftsoError,
      componentsJson: input.componentsJson,
      createdAt,
      updatedAt,
    });

  return requireRow(
    getAgentReliabilityScore(database, input.agentVault),
    `Agent reliability score ${input.agentVault} was not persisted`,
  );
}

export function getAgentReliabilityScore(
  database: SqliteDatabase,
  agentVault: EvmAddress,
): StoredAgentReliabilityScoreRecord | null {
  const row = database
    .prepare<[EvmAddress], AgentReliabilityScoreRow>(
      `
SELECT *
FROM agent_reliability_scores
WHERE agent_vault = ?
`,
    )
    .get(agentVault);

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapAgentReliabilityScoreRow(foundRow);
}

export function listAgentReliabilityScores(
  database: SqliteDatabase,
): readonly StoredAgentReliabilityScoreRecord[] {
  const rows = database
    .prepare<[], AgentReliabilityScoreRow>(
      `
SELECT *
FROM agent_reliability_scores
ORDER BY score DESC, agent_vault ASC
`,
    )
    .all();

  return rows.map(mapAgentReliabilityScoreRow);
}
