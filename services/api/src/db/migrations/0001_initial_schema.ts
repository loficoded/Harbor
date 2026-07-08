export const initialSchemaMigration = {
  id: "0001_initial_schema",
  sql: `
CREATE TABLE IF NOT EXISTS agents (
  agent_vault TEXT PRIMARY KEY,
  owner TEXT,
  payment_address TEXT,
  availability TEXT NOT NULL CHECK (availability IN ('AVAILABLE', 'UNAVAILABLE', 'UNKNOWN')),
  redemption_fee_bips INTEGER,
  available_lots TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  successful_redemptions INTEGER NOT NULL DEFAULT 0,
  failed_redemptions INTEGER NOT NULL DEFAULT 0,
  average_payment_seconds INTEGER,
  score_updated_at TEXT NOT NULL,
  raw_inventory_json TEXT,
  last_inventory_refresh_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redemptions (
  asset_manager_address TEXT NOT NULL,
  request_id TEXT NOT NULL,
  source_chain_id TEXT NOT NULL,
  source_block_number TEXT,
  source_log_index TEXT,
  source_transaction_hash TEXT,
  transaction_hash TEXT,
  redeemer TEXT NOT NULL,
  agent_vault TEXT NOT NULL,
  payment_address TEXT NOT NULL,
  value_uba TEXT NOT NULL,
  fee_uba TEXT NOT NULL,
  payment_reference TEXT NOT NULL,
  first_underlying_block TEXT NOT NULL,
  last_underlying_block TEXT NOT NULL,
  last_underlying_timestamp TEXT NOT NULL,
  executor TEXT,
  executor_fee_nat_wei TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'REQUESTED',
      'WATCHING',
      'SETTLED',
      'WINDOW_EXPIRED',
      'REQUEST_PROOF',
      'PROOF_READY',
      'DEFAULT_SUBMITTED',
      'RECOVERED',
      'FAILED',
      'UNKNOWN'
    )
  ),
  default_transaction_hash TEXT,
  status_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (asset_manager_address, request_id)
);

CREATE INDEX IF NOT EXISTS redemptions_request_id_idx
  ON redemptions (request_id);

CREATE INDEX IF NOT EXISTS redemptions_status_idx
  ON redemptions (status, last_underlying_timestamp);

CREATE INDEX IF NOT EXISTS redemptions_agent_vault_idx
  ON redemptions (agent_vault);

CREATE TABLE IF NOT EXISTS redemption_events (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  block_number TEXT NOT NULL,
  log_index TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  transaction_index TEXT,
  event_name TEXT NOT NULL,
  asset_manager_address TEXT,
  request_id TEXT,
  agent_vault TEXT,
  redeemer TEXT,
  payload_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (chain_id, block_number, log_index),
  UNIQUE (chain_id, transaction_hash, log_index)
);

CREATE INDEX IF NOT EXISTS redemption_events_request_idx
  ON redemption_events (asset_manager_address, request_id);

CREATE TABLE IF NOT EXISTS xrpl_observations (
  observation_id TEXT PRIMARY KEY,
  redemption_request_id TEXT NOT NULL,
  asset_manager_address TEXT,
  transaction_hash TEXT NOT NULL,
  source_address TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  delivered_amount_uba TEXT NOT NULL,
  fee_drops TEXT NOT NULL,
  payment_reference TEXT NOT NULL,
  ledger_index TEXT NOT NULL,
  validated_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (transaction_hash, redemption_request_id)
);

CREATE INDEX IF NOT EXISTS xrpl_observations_redemption_idx
  ON xrpl_observations (asset_manager_address, redemption_request_id);

CREATE TABLE IF NOT EXISTS fdc_requests (
  fdc_request_id TEXT PRIMARY KEY,
  redemption_request_id TEXT NOT NULL,
  asset_manager_address TEXT,
  attestation_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_chain_id TEXT,
  request_body TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUBMITTED', 'FINALIZED', 'FAILED')),
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

CREATE INDEX IF NOT EXISTS fdc_requests_redemption_idx
  ON fdc_requests (asset_manager_address, redemption_request_id);

CREATE INDEX IF NOT EXISTS fdc_requests_status_idx
  ON fdc_requests (status, next_retry_at);

CREATE TABLE IF NOT EXISTS fdc_proofs (
  fdc_proof_id TEXT PRIMARY KEY,
  fdc_request_id TEXT NOT NULL,
  redemption_request_id TEXT NOT NULL,
  asset_manager_address TEXT,
  request_hash TEXT NOT NULL,
  response_body TEXT NOT NULL,
  merkle_proof_json TEXT NOT NULL,
  voting_round_id TEXT NOT NULL,
  proof_json TEXT,
  calldata_json TEXT,
  proof_ready_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (fdc_request_id) REFERENCES fdc_requests (fdc_request_id),
  UNIQUE (fdc_request_id, voting_round_id),
  UNIQUE (request_hash, voting_round_id)
);

CREATE INDEX IF NOT EXISTS fdc_proofs_redemption_idx
  ON fdc_proofs (asset_manager_address, redemption_request_id);

CREATE TABLE IF NOT EXISTS keeper_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  asset_manager_address TEXT,
  redemption_request_id TEXT,
  run_after TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TEXT,
  last_error TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS keeper_jobs_unique_redemption_job_idx
  ON keeper_jobs (job_type, asset_manager_address, redemption_request_id)
  WHERE redemption_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS keeper_jobs_ready_idx
  ON keeper_jobs (status, run_after);

CREATE TABLE IF NOT EXISTS sync_cursors (
  cursor_name TEXT PRIMARY KEY,
  chain_id TEXT,
  block_number TEXT NOT NULL,
  log_index TEXT,
  payload_json TEXT,
  updated_at TEXT NOT NULL
);
`,
} as const;
