import type { SqliteDatabase } from "../db/index.js";
import { nowIso, optionalRow, requireRow } from "./common.js";
import type { SyncCursorRecord, UpsertSyncCursorInput } from "./types.js";

type SyncCursorRow = Readonly<{
  cursor_name: string;
  chain_id: string | null;
  block_number: string;
  log_index: string | null;
  payload_json: string | null;
  updated_at: string;
}>;

function mapSyncCursorRow(row: SyncCursorRow): SyncCursorRecord {
  return {
    cursorName: row.cursor_name,
    chainId: row.chain_id,
    blockNumber: row.block_number,
    logIndex: row.log_index,
    payloadJson: row.payload_json,
    updatedAt: row.updated_at,
  };
}

export function upsertSyncCursor(
  database: SqliteDatabase,
  input: UpsertSyncCursorInput,
): SyncCursorRecord {
  database
    .prepare(
      `
INSERT INTO sync_cursors (
  cursor_name,
  chain_id,
  block_number,
  log_index,
  payload_json,
  updated_at
) VALUES (
  @cursorName,
  @chainId,
  @blockNumber,
  @logIndex,
  @payloadJson,
  @updatedAt
)
ON CONFLICT(cursor_name) DO UPDATE SET
  chain_id = excluded.chain_id,
  block_number = excluded.block_number,
  log_index = excluded.log_index,
  payload_json = excluded.payload_json,
  updated_at = excluded.updated_at
`,
    )
    .run({
      cursorName: input.cursorName,
      chainId: input.chainId ?? null,
      blockNumber: input.blockNumber,
      logIndex: input.logIndex ?? null,
      payloadJson: input.payloadJson ?? null,
      updatedAt: input.updatedAt ?? nowIso(),
    });

  return requireRow(
    getSyncCursor(database, input.cursorName),
    `Sync cursor ${input.cursorName} was not persisted`,
  );
}

export function getSyncCursor(
  database: SqliteDatabase,
  cursorName: string,
): SyncCursorRecord | null {
  const row = database
    .prepare<[string], SyncCursorRow>(
      `
SELECT *
FROM sync_cursors
WHERE cursor_name = ?
`,
    )
    .get(cursorName);

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapSyncCursorRow(foundRow);
}
