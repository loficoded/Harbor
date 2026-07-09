import type { IsoTimestamp } from "./domain.js";

export type ServiceHealthStatus = "ok";

export type ServiceHealth = Readonly<{
  service: string;
  status: ServiceHealthStatus;
  checkedAt: string;
}>;

export function createHealthStatus(
  service: string,
  checkedAt = new Date().toISOString(),
): ServiceHealth {
  return {
    service,
    status: "ok",
    checkedAt,
  };
}

/**
 * Overall health of the API process. `ok` means every critical dependency
 * responded; `error` means at least one critical dependency (currently the
 * database) is unavailable and the API cannot serve authoritative data.
 */
export type HealthReportStatus = "ok" | "error";

export type HealthComponentStatus = "ok" | "error";

export type HealthDatabaseComponent = Readonly<{
  status: HealthComponentStatus;
  migrationsApplied: number | null;
  latestMigrationId: string | null;
  error: string | null;
}>;

/**
 * Position of the FAssets event indexer, mirrored from its persisted sync
 * cursor. `blockNumber` is a stringified integer to stay JSON-safe for block
 * heights that can exceed `Number.MAX_SAFE_INTEGER`.
 */
export type HealthIndexerCursor = Readonly<{
  cursorName: string;
  chainId: string | null;
  blockNumber: string;
  logIndex: string | null;
  updatedAt: IsoTimestamp;
}>;

export type HealthIndexerComponent = Readonly<{
  cursor: HealthIndexerCursor | null;
}>;

export type HealthKeeperComponent = Readonly<{
  totalJobs: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  ready: number;
  lastError: string | null;
  lastUpdatedAt: IsoTimestamp | null;
}>;

/**
 * Highest FDC voting round the backend has fully processed. Sourced from a
 * stored proof when available (`PROOF`) and otherwise from a finalized request
 * (`REQUEST`). `votingRoundId` is stringified to stay JSON-safe.
 */
export type HealthFdcRound = Readonly<{
  votingRoundId: string;
  source: "PROOF" | "REQUEST";
  observedAt: IsoTimestamp;
}>;

export type HealthFdcComponent = Readonly<{
  lastRound: HealthFdcRound | null;
}>;

export type HealthBuildInfo = Readonly<{
  service: string;
  version: string;
  environment: string;
  gitCommit: string | null;
}>;

export type HealthReport = Readonly<{
  status: HealthReportStatus;
  checkedAt: IsoTimestamp;
  api: Readonly<{ status: "ok" }>;
  database: HealthDatabaseComponent;
  indexer: HealthIndexerComponent;
  keeper: HealthKeeperComponent;
  fdc: HealthFdcComponent;
  build: HealthBuildInfo;
}>;
