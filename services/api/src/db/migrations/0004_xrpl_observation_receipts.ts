export const xrplObservationReceiptsMigration = {
  id: "0004_xrpl_observation_receipts",
  sql: `
ALTER TABLE xrpl_observations
  ADD COLUMN close_timestamp TEXT;
`,
} as const;
