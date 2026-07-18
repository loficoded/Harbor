export const redemptionTagFieldsMigration = {
  id: "0007_redemption_tag_fields",
  sql: `
ALTER TABLE redemptions ADD COLUMN destination_tag TEXT;
ALTER TABLE redemptions ADD COLUMN redemption_kind TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE xrpl_observations ADD COLUMN destination_tag TEXT;
`,
} as const;
