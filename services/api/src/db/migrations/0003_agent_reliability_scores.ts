export const agentReliabilityScoresMigration = {
  id: "0003_agent_reliability_scores",
  sql: `
CREATE TABLE IF NOT EXISTS agent_reliability_scores (
  agent_vault TEXT PRIMARY KEY,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  formula_version TEXT NOT NULL,
  fulfillment_rate REAL,
  fulfillment_score REAL NOT NULL,
  settlement_time_score REAL NOT NULL,
  default_penalty REAL NOT NULL,
  availability_score REAL NOT NULL,
  collateral_score REAL NOT NULL,
  successful_redemptions INTEGER NOT NULL,
  defaulted_redemptions INTEGER NOT NULL,
  total_terminal_redemptions INTEGER NOT NULL,
  average_settlement_seconds INTEGER,
  availability TEXT NOT NULL CHECK (availability IN ('AVAILABLE', 'UNAVAILABLE', 'UNKNOWN')),
  available_lots TEXT NOT NULL,
  collateral_ratio_bips TEXT,
  collateral_ratio_source TEXT NOT NULL CHECK (
    collateral_ratio_source IN ('INVENTORY', 'FTSO_DERIVED', 'UNAVAILABLE')
  ),
  ftso_status TEXT NOT NULL CHECK (
    ftso_status IN ('AVAILABLE', 'UNAVAILABLE', 'STALE', 'FAILED')
  ),
  ftso_xrp_usd_price TEXT,
  ftso_flr_usd_price TEXT,
  ftso_timestamp TEXT,
  ftso_error TEXT,
  components_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (agent_vault) REFERENCES agents(agent_vault) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS agent_reliability_scores_score_idx
  ON agent_reliability_scores (score DESC, agent_vault ASC);
`,
} as const;
