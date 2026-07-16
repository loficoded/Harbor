import { initialSchemaMigration } from "./0001_initial_schema.js";
import { agentInventoryFieldsMigration } from "./0002_agent_inventory_fields.js";
import { agentReliabilityScoresMigration } from "./0003_agent_reliability_scores.js";
import { xrplObservationReceiptsMigration } from "./0004_xrpl_observation_receipts.js";
import { fdcRequestProofReadyStatusMigration } from "./0005_fdc_request_proof_ready_status.js";
import { agentDetailsFieldsMigration } from "./0006_agent_details_fields.js";

export type SqlMigration = Readonly<{
  id: string;
  sql: string;
  useTransaction?: boolean;
}>;

export const migrations: readonly SqlMigration[] = [
  initialSchemaMigration,
  agentInventoryFieldsMigration,
  agentReliabilityScoresMigration,
  xrplObservationReceiptsMigration,
  fdcRequestProofReadyStatusMigration,
  agentDetailsFieldsMigration,
];
