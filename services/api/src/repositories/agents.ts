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
  score: number;
  successful_redemptions: number;
  failed_redemptions: number;
  average_payment_seconds: number | null;
  score_updated_at: string;
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
    score: {
      agentVault: row.agent_vault as EvmAddress,
      score: row.score,
      successfulRedemptions: row.successful_redemptions,
      failedRedemptions: row.failed_redemptions,
      averagePaymentSeconds: row.average_payment_seconds,
      updatedAt: row.score_updated_at,
    },
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
  score,
  successful_redemptions,
  failed_redemptions,
  average_payment_seconds,
  score_updated_at,
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
  @score,
  @successfulRedemptions,
  @failedRedemptions,
  @averagePaymentSeconds,
  @scoreUpdatedAt,
  @rawInventoryJson,
  @lastInventoryRefreshAt,
  @createdAt,
  @updatedAt
)
ON CONFLICT(agent_vault) DO UPDATE SET
  owner = COALESCE(excluded.owner, agents.owner),
  payment_address = COALESCE(excluded.payment_address, agents.payment_address),
  availability = excluded.availability,
  redemption_fee_bips = COALESCE(excluded.redemption_fee_bips, agents.redemption_fee_bips),
  available_lots = excluded.available_lots,
  score = excluded.score,
  successful_redemptions = excluded.successful_redemptions,
  failed_redemptions = excluded.failed_redemptions,
  average_payment_seconds = excluded.average_payment_seconds,
  score_updated_at = excluded.score_updated_at,
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
      score: input.score?.score ?? 0,
      successfulRedemptions: input.score?.successfulRedemptions ?? 0,
      failedRedemptions: input.score?.failedRedemptions ?? 0,
      averagePaymentSeconds: input.score?.averagePaymentSeconds ?? null,
      scoreUpdatedAt,
      rawInventoryJson: input.rawInventoryJson ?? null,
      lastInventoryRefreshAt: input.lastInventoryRefreshAt ?? null,
      createdAt,
      updatedAt,
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
