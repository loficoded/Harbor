import {
  parseSerializedBigint,
  serializeBigint,
  type EvmAddress,
} from "@harbor/shared";

import type { SqliteDatabase } from "../db/index.js";
import { nowIso, optionalRow, requireRow } from "./common.js";
import type { StoredAgentRecord, UpsertAgentInput } from "./types.js";

type AgentRow = Readonly<{
  agent_vault: string;
  owner: string | null;
  payment_address: string | null;
  availability: StoredAgentRecord["availability"];
  redemption_fee_bips: number | null;
  available_lots: string;
  agent_name: string | null;
  agent_description: string | null;
  agent_icon_url: string | null;
  agent_terms_of_use_url: string | null;
  score: number;
  successful_redemptions: number;
  failed_redemptions: number;
  average_payment_seconds: number | null;
  score_updated_at: string;
  fee_fields_json: string | null;
  collateral_metadata_json: string | null;
  raw_inventory_json: string | null;
  last_inventory_refresh_at: string | null;
  created_at: string;
  updated_at: string;
}>;

function mapAgentRow(row: AgentRow): StoredAgentRecord {
  return {
    agentVault: row.agent_vault as EvmAddress,
    owner: row.owner as EvmAddress | null,
    paymentAddress: row.payment_address,
    availability: row.availability,
    redemptionFeeBips: row.redemption_fee_bips,
    availableLots: parseSerializedBigint(row.available_lots),
    details: {
      name: row.agent_name,
      description: row.agent_description,
      iconUrl: row.agent_icon_url,
      termsOfUseUrl: row.agent_terms_of_use_url,
    },
    score: {
      agentVault: row.agent_vault as EvmAddress,
      score: row.score,
      successfulRedemptions: row.successful_redemptions,
      failedRedemptions: row.failed_redemptions,
      averagePaymentSeconds: row.average_payment_seconds,
      updatedAt: row.score_updated_at,
    },
    feeFieldsJson: row.fee_fields_json,
    collateralMetadataJson: row.collateral_metadata_json,
    rawInventoryJson: row.raw_inventory_json,
    lastInventoryRefreshAt: row.last_inventory_refresh_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertAgent(
  database: SqliteDatabase,
  input: UpsertAgentInput,
): StoredAgentRecord {
  const createdAt = input.createdAt ?? nowIso();
  const updatedAt = input.updatedAt ?? createdAt;
  const scoreUpdatedAt = input.score?.updatedAt ?? updatedAt;
  const hasAvailability = input.availability === undefined ? 0 : 1;
  const hasAvailableLots = input.availableLots === undefined ? 0 : 1;
  const hasScore = input.score === undefined ? 0 : 1;
  const hasDetails = input.details === undefined ? 0 : 1;

  database
    .prepare(
      `
INSERT INTO agents (
  agent_vault,
  owner,
  payment_address,
  availability,
  redemption_fee_bips,
  available_lots,
  agent_name,
  agent_description,
  agent_icon_url,
  agent_terms_of_use_url,
  score,
  successful_redemptions,
  failed_redemptions,
  average_payment_seconds,
  score_updated_at,
  fee_fields_json,
  collateral_metadata_json,
  raw_inventory_json,
  last_inventory_refresh_at,
  created_at,
  updated_at
) VALUES (
  @agentVault,
  @owner,
  @paymentAddress,
  @availability,
  @redemptionFeeBips,
  @availableLots,
  @agentName,
  @agentDescription,
  @agentIconUrl,
  @agentTermsOfUseUrl,
  @score,
  @successfulRedemptions,
  @failedRedemptions,
  @averagePaymentSeconds,
  @scoreUpdatedAt,
  @feeFieldsJson,
  @collateralMetadataJson,
  @rawInventoryJson,
  @lastInventoryRefreshAt,
  @createdAt,
  @updatedAt
)
ON CONFLICT(agent_vault) DO UPDATE SET
  owner = COALESCE(excluded.owner, agents.owner),
  payment_address = COALESCE(excluded.payment_address, agents.payment_address),
  availability = CASE WHEN @hasAvailability = 1 THEN excluded.availability ELSE agents.availability END,
  redemption_fee_bips = COALESCE(excluded.redemption_fee_bips, agents.redemption_fee_bips),
  available_lots = CASE WHEN @hasAvailableLots = 1 THEN excluded.available_lots ELSE agents.available_lots END,
  agent_name = CASE WHEN @hasDetails = 1 THEN excluded.agent_name ELSE agents.agent_name END,
  agent_description = CASE WHEN @hasDetails = 1 THEN excluded.agent_description ELSE agents.agent_description END,
  agent_icon_url = CASE WHEN @hasDetails = 1 THEN excluded.agent_icon_url ELSE agents.agent_icon_url END,
  agent_terms_of_use_url = CASE WHEN @hasDetails = 1 THEN excluded.agent_terms_of_use_url ELSE agents.agent_terms_of_use_url END,
  score = CASE WHEN @hasScore = 1 THEN excluded.score ELSE agents.score END,
  successful_redemptions = CASE WHEN @hasScore = 1 THEN excluded.successful_redemptions ELSE agents.successful_redemptions END,
  failed_redemptions = CASE WHEN @hasScore = 1 THEN excluded.failed_redemptions ELSE agents.failed_redemptions END,
  average_payment_seconds = CASE WHEN @hasScore = 1 THEN excluded.average_payment_seconds ELSE agents.average_payment_seconds END,
  score_updated_at = CASE WHEN @hasScore = 1 THEN excluded.score_updated_at ELSE agents.score_updated_at END,
  fee_fields_json = COALESCE(excluded.fee_fields_json, agents.fee_fields_json),
  collateral_metadata_json = COALESCE(excluded.collateral_metadata_json, agents.collateral_metadata_json),
  raw_inventory_json = COALESCE(excluded.raw_inventory_json, agents.raw_inventory_json),
  last_inventory_refresh_at = COALESCE(excluded.last_inventory_refresh_at, agents.last_inventory_refresh_at),
  updated_at = excluded.updated_at
`,
    )
    .run({
      agentVault: input.agentVault,
      owner: input.owner ?? null,
      paymentAddress: input.paymentAddress ?? null,
      availability: input.availability ?? "UNKNOWN",
      redemptionFeeBips: input.redemptionFeeBips ?? null,
      availableLots: serializeBigint(input.availableLots ?? 0n),
      agentName: input.details?.name ?? null,
      agentDescription: input.details?.description ?? null,
      agentIconUrl: input.details?.iconUrl ?? null,
      agentTermsOfUseUrl: input.details?.termsOfUseUrl ?? null,
      score: input.score?.score ?? 0,
      successfulRedemptions: input.score?.successfulRedemptions ?? 0,
      failedRedemptions: input.score?.failedRedemptions ?? 0,
      averagePaymentSeconds: input.score?.averagePaymentSeconds ?? null,
      scoreUpdatedAt,
      feeFieldsJson: input.feeFieldsJson ?? null,
      collateralMetadataJson: input.collateralMetadataJson ?? null,
      rawInventoryJson: input.rawInventoryJson ?? null,
      lastInventoryRefreshAt: input.lastInventoryRefreshAt ?? null,
      createdAt,
      updatedAt,
      hasAvailability,
      hasAvailableLots,
      hasScore,
      hasDetails,
    });

  return requireRow(
    getAgent(database, input.agentVault),
    `Agent ${input.agentVault} was not persisted`,
  );
}

export function getAgent(
  database: SqliteDatabase,
  agentVault: EvmAddress,
): StoredAgentRecord | null {
  const row = database
    .prepare<[EvmAddress], AgentRow>(
      `
SELECT *
FROM agents
WHERE agent_vault = ?
`,
    )
    .get(agentVault);

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapAgentRow(foundRow);
}

export function listAgents(
  database: SqliteDatabase,
): readonly StoredAgentRecord[] {
  const rows = database
    .prepare<[], AgentRow>(
      `
SELECT *
FROM agents
ORDER BY score DESC, agent_vault ASC
`,
    )
    .all();

  return rows.map(mapAgentRow);
}
