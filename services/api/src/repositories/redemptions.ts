import {
  parseSerializedBigint,
  serializeBigint,
  type EvmAddress,
  type RedemptionRequestId,
  type TransactionHash,
} from "@harbor/shared";

import type { SqliteDatabase } from "../db/index.js";
import { nowIso, optionalRow, parseJsonPayload, requireRow } from "./common.js";
import type {
  InsertRedemptionEventInput,
  RedemptionEventRecord,
  RedemptionKey,
  StoredRedemptionRequest,
  UpdateRedemptionStatusInput,
  UpsertRedemptionInput,
} from "./types.js";

type RedemptionRow = Readonly<{
  asset_manager_address: string;
  request_id: string;
  source_chain_id: string;
  source_block_number: string | null;
  source_log_index: string | null;
  source_transaction_hash: string | null;
  transaction_hash: string | null;
  redeemer: string;
  agent_vault: string;
  payment_address: string;
  value_uba: string;
  fee_uba: string;
  payment_reference: string;
  first_underlying_block: string;
  last_underlying_block: string;
  last_underlying_timestamp: string;
  executor: string | null;
  executor_fee_nat_wei: string;
  status: StoredRedemptionRequest["status"];
  default_transaction_hash: string | null;
  status_reason: string | null;
  created_at: string;
  updated_at: string;
}>;

type RedemptionEventRow = Readonly<{
  chain_id: string;
  contract_address: string;
  block_number: string;
  log_index: string;
  transaction_hash: string;
  transaction_index: string | null;
  event_name: string;
  asset_manager_address: string | null;
  request_id: string | null;
  agent_vault: string | null;
  redeemer: string | null;
  payload_json: string;
  observed_at: string;
  created_at: string;
}>;

function mapRedemptionRow(row: RedemptionRow): StoredRedemptionRequest {
  return {
    assetManagerAddress: row.asset_manager_address as EvmAddress,
    requestId: row.request_id,
    sourceChainId: row.source_chain_id,
    sourceBlockNumber: row.source_block_number,
    sourceLogIndex: row.source_log_index,
    sourceTransactionHash:
      row.source_transaction_hash as TransactionHash | null,
    transactionHash: row.transaction_hash as TransactionHash | null,
    redeemer: row.redeemer as EvmAddress,
    agentVault: row.agent_vault as EvmAddress,
    paymentAddress: row.payment_address,
    valueUBA: parseSerializedBigint(row.value_uba),
    feeUBA: parseSerializedBigint(row.fee_uba),
    paymentReference:
      row.payment_reference as StoredRedemptionRequest["paymentReference"],
    firstUnderlyingBlock: parseSerializedBigint(row.first_underlying_block),
    lastUnderlyingBlock: parseSerializedBigint(row.last_underlying_block),
    lastUnderlyingTimestamp: parseSerializedBigint(
      row.last_underlying_timestamp,
    ),
    executor: row.executor as EvmAddress | null,
    executorFeeNatWei: parseSerializedBigint(row.executor_fee_nat_wei),
    status: row.status,
    defaultTransactionHash:
      row.default_transaction_hash as TransactionHash | null,
    statusReason: row.status_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRedemptionEventRow(row: RedemptionEventRow): RedemptionEventRecord {
  return {
    chainId: row.chain_id,
    contractAddress: row.contract_address as EvmAddress,
    blockNumber: row.block_number,
    logIndex: row.log_index,
    transactionHash: row.transaction_hash as TransactionHash,
    transactionIndex: row.transaction_index,
    eventName: row.event_name,
    assetManagerAddress: row.asset_manager_address as EvmAddress | null,
    requestId: row.request_id as RedemptionRequestId | null,
    agentVault: row.agent_vault as EvmAddress | null,
    redeemer: row.redeemer as EvmAddress | null,
    payload: parseJsonPayload(row.payload_json),
    observedAt: row.observed_at,
    createdAt: row.created_at,
  };
}

export function upsertRedemption(
  database: SqliteDatabase,
  input: UpsertRedemptionInput,
): StoredRedemptionRequest {
  const createdAt = input.createdAt ?? nowIso();
  const updatedAt = input.updatedAt ?? createdAt;

  database
    .prepare(
      `
INSERT INTO redemptions (
  asset_manager_address,
  request_id,
  source_chain_id,
  source_block_number,
  source_log_index,
  source_transaction_hash,
  transaction_hash,
  redeemer,
  agent_vault,
  payment_address,
  value_uba,
  fee_uba,
  payment_reference,
  first_underlying_block,
  last_underlying_block,
  last_underlying_timestamp,
  executor,
  executor_fee_nat_wei,
  status,
  default_transaction_hash,
  status_reason,
  created_at,
  updated_at
) VALUES (
  @assetManagerAddress,
  @requestId,
  @sourceChainId,
  @sourceBlockNumber,
  @sourceLogIndex,
  @sourceTransactionHash,
  @transactionHash,
  @redeemer,
  @agentVault,
  @paymentAddress,
  @valueUBA,
  @feeUBA,
  @paymentReference,
  @firstUnderlyingBlock,
  @lastUnderlyingBlock,
  @lastUnderlyingTimestamp,
  @executor,
  @executorFeeNatWei,
  @status,
  @defaultTransactionHash,
  @statusReason,
  @createdAt,
  @updatedAt
)
ON CONFLICT(asset_manager_address, request_id) DO UPDATE SET
  source_chain_id = excluded.source_chain_id,
  source_block_number = COALESCE(excluded.source_block_number, redemptions.source_block_number),
  source_log_index = COALESCE(excluded.source_log_index, redemptions.source_log_index),
  source_transaction_hash = COALESCE(excluded.source_transaction_hash, redemptions.source_transaction_hash),
  transaction_hash = COALESCE(excluded.transaction_hash, redemptions.transaction_hash),
  redeemer = excluded.redeemer,
  agent_vault = excluded.agent_vault,
  payment_address = excluded.payment_address,
  value_uba = excluded.value_uba,
  fee_uba = excluded.fee_uba,
  payment_reference = excluded.payment_reference,
  first_underlying_block = excluded.first_underlying_block,
  last_underlying_block = excluded.last_underlying_block,
  last_underlying_timestamp = excluded.last_underlying_timestamp,
  executor = COALESCE(excluded.executor, redemptions.executor),
  executor_fee_nat_wei = excluded.executor_fee_nat_wei,
  default_transaction_hash = COALESCE(excluded.default_transaction_hash, redemptions.default_transaction_hash),
  status_reason = COALESCE(excluded.status_reason, redemptions.status_reason),
  updated_at = excluded.updated_at
`,
    )
    .run({
      assetManagerAddress: input.assetManagerAddress,
      requestId: input.requestId,
      sourceChainId: input.sourceChainId,
      sourceBlockNumber: input.sourceBlockNumber ?? null,
      sourceLogIndex: input.sourceLogIndex ?? null,
      sourceTransactionHash: input.sourceTransactionHash ?? null,
      transactionHash: input.transactionHash ?? null,
      redeemer: input.redeemer,
      agentVault: input.agentVault,
      paymentAddress: input.paymentAddress,
      valueUBA: serializeBigint(input.valueUBA),
      feeUBA: serializeBigint(input.feeUBA),
      paymentReference: input.paymentReference,
      firstUnderlyingBlock: serializeBigint(input.firstUnderlyingBlock),
      lastUnderlyingBlock: serializeBigint(input.lastUnderlyingBlock),
      lastUnderlyingTimestamp: serializeBigint(input.lastUnderlyingTimestamp),
      executor: input.executor ?? null,
      executorFeeNatWei: serializeBigint(input.executorFeeNatWei),
      status: input.status ?? "REQUESTED",
      defaultTransactionHash: input.defaultTransactionHash ?? null,
      statusReason: input.statusReason ?? null,
      createdAt,
      updatedAt,
    });

  return requireRow(
    getRedemption(database, input),
    `Redemption ${input.assetManagerAddress}/${input.requestId} was not persisted`,
  );
}

export function getRedemption(
  database: SqliteDatabase,
  key: RedemptionKey,
): StoredRedemptionRequest | null {
  const row = database
    .prepare<RedemptionKey, RedemptionRow>(
      `
SELECT *
FROM redemptions
WHERE asset_manager_address = @assetManagerAddress
  AND request_id = @requestId
`,
    )
    .get(key);

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapRedemptionRow(foundRow);
}

export function getRedemptionByRequestId(
  database: SqliteDatabase,
  requestId: RedemptionRequestId,
): StoredRedemptionRequest | null {
  const row = database
    .prepare<[RedemptionRequestId], RedemptionRow>(
      `
SELECT *
FROM redemptions
WHERE request_id = ?
ORDER BY updated_at DESC
LIMIT 1
`,
    )
    .get(requestId);

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapRedemptionRow(foundRow);
}

export function listRedemptionsByStatuses(
  database: SqliteDatabase,
  statuses: readonly StoredRedemptionRequest["status"][],
): readonly StoredRedemptionRequest[] {
  if (statuses.length === 0) {
    return [];
  }

  const placeholders = statuses.map(() => "?").join(", ");
  const rows = database
    .prepare<StoredRedemptionRequest["status"][], RedemptionRow>(
      `
SELECT *
FROM redemptions
WHERE status IN (${placeholders})
ORDER BY updated_at ASC
`,
    )
    .all(...statuses);

  return rows.map(mapRedemptionRow);
}

export function updateRedemptionStatus(
  database: SqliteDatabase,
  input: UpdateRedemptionStatusInput,
): StoredRedemptionRequest {
  database
    .prepare(
      `
UPDATE redemptions
SET
  status = @status,
  transaction_hash = COALESCE(@transactionHash, transaction_hash),
  default_transaction_hash = COALESCE(@defaultTransactionHash, default_transaction_hash),
  status_reason = COALESCE(@statusReason, status_reason),
  updated_at = @updatedAt
WHERE asset_manager_address = @assetManagerAddress
  AND request_id = @requestId
`,
    )
    .run({
      assetManagerAddress: input.assetManagerAddress,
      requestId: input.requestId,
      status: input.status,
      transactionHash: input.transactionHash ?? null,
      defaultTransactionHash: input.defaultTransactionHash ?? null,
      statusReason: input.statusReason ?? null,
      updatedAt: input.updatedAt ?? nowIso(),
    });

  return requireRow(
    getRedemption(database, input),
    `Redemption ${input.assetManagerAddress}/${input.requestId} does not exist`,
  );
}

export function insertRedemptionEvent(
  database: SqliteDatabase,
  input: InsertRedemptionEventInput,
): RedemptionEventRecord {
  const createdAt = input.createdAt ?? nowIso();

  database
    .prepare(
      `
INSERT INTO redemption_events (
  chain_id,
  contract_address,
  block_number,
  log_index,
  transaction_hash,
  transaction_index,
  event_name,
  asset_manager_address,
  request_id,
  agent_vault,
  redeemer,
  payload_json,
  observed_at,
  created_at
) VALUES (
  @chainId,
  @contractAddress,
  @blockNumber,
  @logIndex,
  @transactionHash,
  @transactionIndex,
  @eventName,
  @assetManagerAddress,
  @requestId,
  @agentVault,
  @redeemer,
  @payloadJson,
  @observedAt,
  @createdAt
)
ON CONFLICT(chain_id, block_number, log_index) DO NOTHING
`,
    )
    .run({
      chainId: input.chainId,
      contractAddress: input.contractAddress,
      blockNumber: input.blockNumber,
      logIndex: input.logIndex,
      transactionHash: input.transactionHash,
      transactionIndex: input.transactionIndex,
      eventName: input.eventName,
      assetManagerAddress: input.assetManagerAddress,
      requestId: input.requestId,
      agentVault: input.agentVault,
      redeemer: input.redeemer,
      payloadJson: JSON.stringify(input.payload),
      observedAt: input.observedAt,
      createdAt,
    });

  return requireRow(
    getRedemptionEvent(database, {
      chainId: input.chainId,
      blockNumber: input.blockNumber,
      logIndex: input.logIndex,
    }),
    `Redemption event ${input.chainId}/${input.blockNumber}/${input.logIndex} was not persisted`,
  );
}

export function getRedemptionEvent(
  database: SqliteDatabase,
  identity: Readonly<{
    chainId: string;
    blockNumber: string;
    logIndex: string;
  }>,
): RedemptionEventRecord | null {
  const row = database
    .prepare<typeof identity, RedemptionEventRow>(
      `
SELECT *
FROM redemption_events
WHERE chain_id = @chainId
  AND block_number = @blockNumber
  AND log_index = @logIndex
`,
    )
    .get(identity);

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapRedemptionEventRow(foundRow);
}
