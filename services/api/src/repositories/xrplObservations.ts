import {
  parseSerializedBigint,
  serializeBigint,
  type Bytes32,
  type EvmAddress,
  type RedemptionRequestId,
  type TransactionHash,
} from "@harbor/shared";

import type { SqliteDatabase } from "../db/index.js";
import { nowIso, optionalRow, requireRow } from "./common.js";
import type {
  StoredXrplPaymentObservation,
  UpsertXrplObservationInput,
} from "./types.js";

type XrplObservationRow = Readonly<{
  observation_id: string;
  redemption_request_id: string;
  asset_manager_address: string | null;
  transaction_hash: string;
  source_address: string;
  destination_address: string;
  delivered_amount_uba: string;
  fee_drops: string;
  payment_reference: string;
  ledger_index: string;
  validated_at: string;
  raw_json: string | null;
  created_at: string;
}>;

function mapXrplObservationRow(
  row: XrplObservationRow,
): StoredXrplPaymentObservation {
  return {
    observationId: row.observation_id,
    redemptionRequestId: row.redemption_request_id,
    assetManagerAddress: row.asset_manager_address as EvmAddress | null,
    transactionHash: row.transaction_hash as TransactionHash,
    sourceAddress: row.source_address,
    destinationAddress: row.destination_address,
    deliveredAmountUBA: parseSerializedBigint(row.delivered_amount_uba),
    feeDrops: parseSerializedBigint(row.fee_drops),
    paymentReference: row.payment_reference as Bytes32,
    ledgerIndex: parseSerializedBigint(row.ledger_index),
    validatedAt: row.validated_at,
    rawJson: row.raw_json,
    createdAt: row.created_at,
  };
}

export function upsertXrplObservation(
  database: SqliteDatabase,
  input: UpsertXrplObservationInput,
): StoredXrplPaymentObservation {
  const createdAt = input.createdAt ?? nowIso();

  database
    .prepare(
      `
INSERT INTO xrpl_observations (
  observation_id,
  redemption_request_id,
  asset_manager_address,
  transaction_hash,
  source_address,
  destination_address,
  delivered_amount_uba,
  fee_drops,
  payment_reference,
  ledger_index,
  validated_at,
  raw_json,
  created_at
) VALUES (
  @observationId,
  @redemptionRequestId,
  @assetManagerAddress,
  @transactionHash,
  @sourceAddress,
  @destinationAddress,
  @deliveredAmountUBA,
  @feeDrops,
  @paymentReference,
  @ledgerIndex,
  @validatedAt,
  @rawJson,
  @createdAt
)
ON CONFLICT(transaction_hash, redemption_request_id) DO UPDATE SET
  asset_manager_address = COALESCE(excluded.asset_manager_address, xrpl_observations.asset_manager_address),
  source_address = excluded.source_address,
  destination_address = excluded.destination_address,
  delivered_amount_uba = excluded.delivered_amount_uba,
  fee_drops = excluded.fee_drops,
  payment_reference = excluded.payment_reference,
  ledger_index = excluded.ledger_index,
  validated_at = excluded.validated_at,
  raw_json = COALESCE(excluded.raw_json, xrpl_observations.raw_json)
`,
    )
    .run({
      observationId: input.observationId,
      redemptionRequestId: input.redemptionRequestId,
      assetManagerAddress: input.assetManagerAddress ?? null,
      transactionHash: input.transactionHash,
      sourceAddress: input.sourceAddress,
      destinationAddress: input.destinationAddress,
      deliveredAmountUBA: serializeBigint(input.deliveredAmountUBA),
      feeDrops: serializeBigint(input.feeDrops),
      paymentReference: input.paymentReference,
      ledgerIndex: serializeBigint(input.ledgerIndex),
      validatedAt: input.validatedAt,
      rawJson: input.rawJson ?? null,
      createdAt,
    });

  return requireRow(
    getXrplObservationByTransaction(
      database,
      input.transactionHash,
      input.redemptionRequestId,
    ),
    `XRPL observation ${input.transactionHash}/${input.redemptionRequestId} was not persisted`,
  );
}

export function getXrplObservation(
  database: SqliteDatabase,
  observationId: string,
): StoredXrplPaymentObservation | null {
  const row = database
    .prepare<[string], XrplObservationRow>(
      `
SELECT *
FROM xrpl_observations
WHERE observation_id = ?
`,
    )
    .get(observationId);

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapXrplObservationRow(foundRow);
}

export function getXrplObservationByTransaction(
  database: SqliteDatabase,
  transactionHash: TransactionHash,
  redemptionRequestId: RedemptionRequestId,
): StoredXrplPaymentObservation | null {
  const row = database
    .prepare<[TransactionHash, RedemptionRequestId], XrplObservationRow>(
      `
SELECT *
FROM xrpl_observations
WHERE transaction_hash = ?
  AND redemption_request_id = ?
`,
    )
    .get(transactionHash, redemptionRequestId);

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapXrplObservationRow(foundRow);
}

export function listXrplObservationsForRedemption(
  database: SqliteDatabase,
  redemptionRequestId: RedemptionRequestId,
): readonly StoredXrplPaymentObservation[] {
  const rows = database
    .prepare<[RedemptionRequestId], XrplObservationRow>(
      `
SELECT *
FROM xrpl_observations
WHERE redemption_request_id = ?
ORDER BY ledger_index ASC
`,
    )
    .all(redemptionRequestId);

  return rows.map(mapXrplObservationRow);
}
