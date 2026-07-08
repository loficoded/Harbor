export const fdcRequestProofReadyStatusMigration = {
  id: "0005_fdc_request_proof_ready_status",
  useTransaction: false,
  sql: `
PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS fdc_requests_new;

CREATE TABLE fdc_requests_new (
  fdc_request_id TEXT PRIMARY KEY,
  redemption_request_id TEXT NOT NULL,
  asset_manager_address TEXT,
  attestation_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_chain_id TEXT,
  request_body TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUBMITTED', 'FINALIZED', 'PROOF_READY', 'FAILED')),
  voting_round_id TEXT,
  submission_transaction_hash TEXT,
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (request_body),
  UNIQUE (request_hash)
);

INSERT INTO fdc_requests_new (
  fdc_request_id,
  redemption_request_id,
  asset_manager_address,
  attestation_type,
  source_id,
  source_chain_id,
  request_body,
  request_hash,
  status,
  voting_round_id,
  submission_transaction_hash,
  last_error,
  retry_count,
  next_retry_at,
  created_at,
  updated_at
)
SELECT
  fdc_request_id,
  redemption_request_id,
  asset_manager_address,
  attestation_type,
  source_id,
  source_chain_id,
  request_body,
  request_hash,
  status,
  voting_round_id,
  submission_transaction_hash,
  last_error,
  retry_count,
  next_retry_at,
  created_at,
  updated_at
FROM fdc_requests;

DROP TABLE fdc_requests;
ALTER TABLE fdc_requests_new RENAME TO fdc_requests;

CREATE INDEX IF NOT EXISTS fdc_requests_redemption_idx
  ON fdc_requests (asset_manager_address, redemption_request_id);

CREATE INDEX IF NOT EXISTS fdc_requests_status_idx
  ON fdc_requests (status, next_retry_at);

PRAGMA foreign_keys = ON;
`,
} as const;
