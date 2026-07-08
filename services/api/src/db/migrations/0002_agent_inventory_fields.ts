export const agentInventoryFieldsMigration = {
  id: "0002_agent_inventory_fields",
  sql: `
ALTER TABLE agents ADD COLUMN fee_fields_json TEXT;
ALTER TABLE agents ADD COLUMN collateral_metadata_json TEXT;
`,
};
