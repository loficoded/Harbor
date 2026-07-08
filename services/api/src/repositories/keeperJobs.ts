import type { EvmAddress } from "@harbor/shared";

import type { SqliteDatabase } from "../db/index.js";
import { nowIso, optionalRow, requireRow } from "./common.js";
import type { KeeperJobRecord, UpsertKeeperJobInput } from "./types.js";

type KeeperJobRow = Readonly<{
  job_id: string;
  job_type: string;
  status: KeeperJobRecord["status"];
  asset_manager_address: string | null;
  redemption_request_id: string | null;
  run_after: string;
  attempts: number;
  locked_at: string | null;
  last_error: string | null;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
}>;

function mapKeeperJobRow(row: KeeperJobRow): KeeperJobRecord {
  return {
    jobId: row.job_id,
    jobType: row.job_type,
    status: row.status,
    assetManagerAddress: row.asset_manager_address as EvmAddress | null,
    redemptionRequestId: row.redemption_request_id,
    runAfter: row.run_after,
    attempts: row.attempts,
    lockedAt: row.locked_at,
    lastError: row.last_error,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertKeeperJob(
  database: SqliteDatabase,
  input: UpsertKeeperJobInput,
): KeeperJobRecord {
  const createdAt = input.createdAt ?? nowIso();
  const updatedAt = input.updatedAt ?? createdAt;

  database
    .prepare(
      `
INSERT INTO keeper_jobs (
  job_id,
  job_type,
  status,
  asset_manager_address,
  redemption_request_id,
  run_after,
  attempts,
  locked_at,
  last_error,
  payload_json,
  created_at,
  updated_at
) VALUES (
  @jobId,
  @jobType,
  @status,
  @assetManagerAddress,
  @redemptionRequestId,
  @runAfter,
  @attempts,
  @lockedAt,
  @lastError,
  @payloadJson,
  @createdAt,
  @updatedAt
)
ON CONFLICT(job_id) DO UPDATE SET
  job_type = excluded.job_type,
  status = excluded.status,
  asset_manager_address = excluded.asset_manager_address,
  redemption_request_id = excluded.redemption_request_id,
  run_after = excluded.run_after,
  attempts = excluded.attempts,
  locked_at = excluded.locked_at,
  last_error = excluded.last_error,
  payload_json = excluded.payload_json,
  updated_at = excluded.updated_at
`,
    )
    .run({
      jobId: input.jobId,
      jobType: input.jobType,
      status: input.status ?? "PENDING",
      assetManagerAddress: input.assetManagerAddress ?? null,
      redemptionRequestId: input.redemptionRequestId ?? null,
      runAfter: input.runAfter,
      attempts: input.attempts ?? 0,
      lockedAt: input.lockedAt ?? null,
      lastError: input.lastError ?? null,
      payloadJson: input.payloadJson ?? null,
      createdAt,
      updatedAt,
    });

  return requireRow(
    getKeeperJob(database, input.jobId),
    `Keeper job ${input.jobId} was not persisted`,
  );
}

export function getKeeperJob(
  database: SqliteDatabase,
  jobId: string,
): KeeperJobRecord | null {
  const row = database
    .prepare<[string], KeeperJobRow>(
      `
SELECT *
FROM keeper_jobs
WHERE job_id = ?
`,
    )
    .get(jobId);

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapKeeperJobRow(foundRow);
}

export function updateKeeperJobStatus(
  database: SqliteDatabase,
  input: Readonly<{
    jobId: string;
    status: KeeperJobRecord["status"];
    attempts?: number;
    lockedAt?: string | null;
    lastError?: string | null;
    updatedAt?: string;
  }>,
): KeeperJobRecord {
  const current = requireRow(
    getKeeperJob(database, input.jobId),
    `Keeper job ${input.jobId} does not exist`,
  );

  database
    .prepare(
      `
UPDATE keeper_jobs
SET
  status = @status,
  attempts = @attempts,
  locked_at = @lockedAt,
  last_error = @lastError,
  updated_at = @updatedAt
WHERE job_id = @jobId
`,
    )
    .run({
      jobId: input.jobId,
      status: input.status,
      attempts: input.attempts ?? current.attempts,
      lockedAt: input.lockedAt ?? current.lockedAt,
      lastError: input.lastError ?? current.lastError,
      updatedAt: input.updatedAt ?? nowIso(),
    });

  return requireRow(
    getKeeperJob(database, input.jobId),
    `Keeper job ${input.jobId} does not exist after update`,
  );
}

export function listReadyKeeperJobs(
  database: SqliteDatabase,
  now: string,
  limit: number,
): readonly KeeperJobRecord[] {
  const rows = database
    .prepare<[string, number], KeeperJobRow>(
      `
SELECT *
FROM keeper_jobs
WHERE status = 'PENDING'
  AND run_after <= ?
ORDER BY run_after ASC, created_at ASC
LIMIT ?
`,
    )
    .all(now, limit);

  return rows.map(mapKeeperJobRow);
}
