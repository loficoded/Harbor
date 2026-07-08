import { initialSchemaMigration } from "./0001_initial_schema.js";
import { agentInventoryFieldsMigration } from "./0002_agent_inventory_fields.js";

export type SqlMigration = Readonly<{
  id: string;
  sql: string;
}>;

export const migrations = [
  initialSchemaMigration,
  agentInventoryFieldsMigration,
] as const satisfies readonly SqlMigration[];
