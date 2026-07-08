import { initialSchemaMigration } from "./0001_initial_schema.js";
import { agentInventoryFieldsMigration } from "./0002_agent_inventory_fields.js";
import { agentReliabilityScoresMigration } from "./0003_agent_reliability_scores.js";
import { xrplObservationReceiptsMigration } from "./0004_xrpl_observation_receipts.js";

export type SqlMigration = Readonly<{
  id: string;
  sql: string;
}>;

export const migrations = [
  initialSchemaMigration,
  agentInventoryFieldsMigration,
  agentReliabilityScoresMigration,
  xrplObservationReceiptsMigration,
] as const satisfies readonly SqlMigration[];
