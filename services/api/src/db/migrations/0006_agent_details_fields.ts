export const agentDetailsFieldsMigration = {
  id: "0006_agent_details_fields",
  sql: `
ALTER TABLE agents ADD COLUMN agent_name TEXT;
ALTER TABLE agents ADD COLUMN agent_description TEXT;
ALTER TABLE agents ADD COLUMN agent_icon_url TEXT;
ALTER TABLE agents ADD COLUMN agent_terms_of_use_url TEXT;
`,
};
