import {
  parseSerializedBigint,
  serializeBigint,
  type Bytes32,
  type EvmAddress,
  type HexString,
  type TransactionHash,
} from "@harbor/shared";

import type { SqliteDatabase } from "../db/index.js";
import { nowIso, optionalRow, requireRow } from "./common.js";
import type {
  InsertFdcProofInput,
  StoredFdcProofRecord,
  StoredFdcRequestRecord,
  UpdateFdcRequestStatusInput,
  UpsertFdcRequestInput,
} from "./types.js";

type FdcRequestRow = Readonly<{
  fdc_request_id: string;
  redemption_request_id: string;
  asset_manager_address: string | null;
  attestation_type: string;
  source_id: string;
  source_chain_id: string | null;
  request_body: string;
  request_hash: string;
  status: StoredFdcRequestRecord["status"];
  voting_round_id: string | null;
  submission_transaction_hash: string | null;
  last_error: string | null;
  retry_count: number;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}>;

type FdcProofRow = Readonly<{
  fdc_proof_id: string;
  fdc_request_id: string;
  redemption_request_id: string;
  asset_manager_address: string | null;
  request_hash: string;
  response_body: string;
  merkle_proof_json: string;
  voting_round_id: string;
  proof_json: string | null;
  calldata_json: string | null;
  proof_ready_at: string | null;
  created_at: string;
}>;

function mapFdcRequestRow(row: FdcRequestRow): StoredFdcRequestRecord {
  return {
    fdcRequestId: row.fdc_request_id,
    redemptionRequestId: row.redemption_request_id,
    assetManagerAddress: row.asset_manager_address as EvmAddress | null,
    attestationType: row.attestation_type as Bytes32,
    sourceId: row.source_id as Bytes32,
    sourceChainId: row.source_chain_id,
    requestBody: row.request_body as HexString,
    requestHash: row.request_hash as Bytes32,
    status: row.status,
    votingRoundId:
      row.voting_round_id === null
        ? null
        : parseSerializedBigint(row.voting_round_id),
    submissionTransactionHash:
      row.submission_transaction_hash as TransactionHash | null,
    lastError: row.last_error,
    retryCount: row.retry_count,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFdcProofRow(row: FdcProofRow): StoredFdcProofRecord {
  return {
    fdcProofId: row.fdc_proof_id,
    fdcRequestId: row.fdc_request_id,
    redemptionRequestId: row.redemption_request_id,
    assetManagerAddress: row.asset_manager_address as EvmAddress | null,
    requestHash: row.request_hash as Bytes32,
    responseBody: row.response_body as HexString,
    merkleProof: JSON.parse(row.merkle_proof_json) as readonly Bytes32[],
    votingRoundId: parseSerializedBigint(row.voting_round_id),
    proofJson: row.proof_json,
    calldataJson: row.calldata_json,
    proofReadyAt: row.proof_ready_at,
    createdAt: row.created_at,
  };
}

export function upsertFdcRequest(
  database: SqliteDatabase,
  input: UpsertFdcRequestInput,
): StoredFdcRequestRecord {
  const existing = findFdcRequestByBodyOrHash(
    database,
    input.requestBody,
    input.requestHash,
  );

  if (existing !== null) {
    const updateInput: UpdateFdcRequestStatusInput = {
      fdcRequestId: existing.fdcRequestId,
      status: input.status ?? existing.status,
      votingRoundId: input.votingRoundId ?? existing.votingRoundId,
      submissionTransactionHash:
        input.submissionTransactionHash === undefined
          ? existing.submissionTransactionHash
          : input.submissionTransactionHash,
      lastError:
        input.lastError === undefined ? existing.lastError : input.lastError,
      retryCount: input.retryCount ?? existing.retryCount,
      nextRetryAt:
        input.nextRetryAt === undefined
          ? existing.nextRetryAt
          : input.nextRetryAt,
    };

    if (input.updatedAt !== undefined) {
      return updateFdcRequestStatus(database, {
        ...updateInput,
        updatedAt: input.updatedAt,
      });
    }

    return updateFdcRequestStatus(database, updateInput);
  }

  const createdAt = input.createdAt ?? nowIso();
  const updatedAt = input.updatedAt ?? createdAt;

  database
    .prepare(
      `
INSERT INTO fdc_requests (
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
) VALUES (
  @fdcRequestId,
  @redemptionRequestId,
  @assetManagerAddress,
  @attestationType,
  @sourceId,
  @sourceChainId,
  @requestBody,
  @requestHash,
  @status,
  @votingRoundId,
  @submissionTransactionHash,
  @lastError,
  @retryCount,
  @nextRetryAt,
  @createdAt,
  @updatedAt
)
`,
    )
    .run({
      fdcRequestId: input.fdcRequestId,
      redemptionRequestId: input.redemptionRequestId,
      assetManagerAddress: input.assetManagerAddress ?? null,
      attestationType: input.attestationType,
      sourceId: input.sourceId,
      sourceChainId: input.sourceChainId ?? null,
      requestBody: input.requestBody,
      requestHash: input.requestHash,
      status: input.status ?? "PENDING",
      votingRoundId:
        input.votingRoundId === undefined || input.votingRoundId === null
          ? null
          : serializeBigint(input.votingRoundId),
      submissionTransactionHash: input.submissionTransactionHash ?? null,
      lastError: input.lastError ?? null,
      retryCount: input.retryCount ?? 0,
      nextRetryAt: input.nextRetryAt ?? null,
      createdAt,
      updatedAt,
    });

  return requireRow(
    getFdcRequest(database, input.fdcRequestId),
    `FDC request ${input.fdcRequestId} was not persisted`,
  );
}

export function updateFdcRequestStatus(
  database: SqliteDatabase,
  input: UpdateFdcRequestStatusInput,
): StoredFdcRequestRecord {
  const current = requireRow(
    getFdcRequest(database, input.fdcRequestId),
    `FDC request ${input.fdcRequestId} does not exist`,
  );

  database
    .prepare(
      `
UPDATE fdc_requests
SET
  status = @status,
  voting_round_id = @votingRoundId,
  submission_transaction_hash = @submissionTransactionHash,
  last_error = @lastError,
  retry_count = @retryCount,
  next_retry_at = @nextRetryAt,
  updated_at = @updatedAt
WHERE fdc_request_id = @fdcRequestId
`,
    )
    .run({
      fdcRequestId: input.fdcRequestId,
      status: input.status,
      votingRoundId:
        input.votingRoundId === undefined || input.votingRoundId === null
          ? current.votingRoundId === null
            ? null
            : serializeBigint(current.votingRoundId)
          : serializeBigint(input.votingRoundId),
      submissionTransactionHash:
        input.submissionTransactionHash === undefined
          ? current.submissionTransactionHash
          : input.submissionTransactionHash,
      lastError:
        input.lastError === undefined ? current.lastError : input.lastError,
      retryCount: input.retryCount ?? current.retryCount,
      nextRetryAt:
        input.nextRetryAt === undefined
          ? current.nextRetryAt
          : input.nextRetryAt,
      updatedAt: input.updatedAt ?? nowIso(),
    });

  return requireRow(
    getFdcRequest(database, input.fdcRequestId),
    `FDC request ${input.fdcRequestId} does not exist after update`,
  );
}

export function getFdcRequest(
  database: SqliteDatabase,
  fdcRequestId: string,
): StoredFdcRequestRecord | null {
  const row = database
    .prepare<[string], FdcRequestRow>(
      `
SELECT *
FROM fdc_requests
WHERE fdc_request_id = ?
`,
    )
    .get(fdcRequestId);

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapFdcRequestRow(foundRow);
}

export function getFdcRequestByHash(
  database: SqliteDatabase,
  requestHash: Bytes32,
): StoredFdcRequestRecord | null {
  const row = database
    .prepare<[Bytes32], FdcRequestRow>(
      `
SELECT *
FROM fdc_requests
WHERE request_hash = ?
`,
    )
    .get(requestHash);

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapFdcRequestRow(foundRow);
}

export function findFdcRequestByBodyOrHash(
  database: SqliteDatabase,
  requestBody: HexString,
  requestHash: Bytes32,
): StoredFdcRequestRecord | null {
  const row = database
    .prepare<[HexString, Bytes32], FdcRequestRow>(
      `
SELECT *
FROM fdc_requests
WHERE request_body = ?
   OR request_hash = ?
ORDER BY created_at ASC
LIMIT 1
`,
    )
    .get(requestBody, requestHash);

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapFdcRequestRow(foundRow);
}

export function listFdcRequestsForRedemption(
  database: SqliteDatabase,
  redemptionRequestId: string,
): readonly StoredFdcRequestRecord[] {
  const rows = database
    .prepare<[string], FdcRequestRow>(
      `
SELECT *
FROM fdc_requests
WHERE redemption_request_id = ?
ORDER BY created_at ASC
`,
    )
    .all(redemptionRequestId);

  return rows.map(mapFdcRequestRow);
}

export function insertFdcProof(
  database: SqliteDatabase,
  input: InsertFdcProofInput,
): StoredFdcProofRecord {
  const existing = getFdcProofByRequestAndRound(
    database,
    input.fdcRequestId,
    input.votingRoundId,
  );

  if (existing !== null) {
    return existing;
  }

  database
    .prepare(
      `
INSERT INTO fdc_proofs (
  fdc_proof_id,
  fdc_request_id,
  redemption_request_id,
  asset_manager_address,
  request_hash,
  response_body,
  merkle_proof_json,
  voting_round_id,
  proof_json,
  calldata_json,
  proof_ready_at,
  created_at
) VALUES (
  @fdcProofId,
  @fdcRequestId,
  @redemptionRequestId,
  @assetManagerAddress,
  @requestHash,
  @responseBody,
  @merkleProofJson,
  @votingRoundId,
  @proofJson,
  @calldataJson,
  @proofReadyAt,
  @createdAt
)
`,
    )
    .run({
      fdcProofId: input.fdcProofId,
      fdcRequestId: input.fdcRequestId,
      redemptionRequestId: input.redemptionRequestId,
      assetManagerAddress: input.assetManagerAddress ?? null,
      requestHash: input.requestHash,
      responseBody: input.responseBody,
      merkleProofJson: JSON.stringify(input.merkleProof),
      votingRoundId: serializeBigint(input.votingRoundId),
      proofJson: input.proofJson ?? null,
      calldataJson: input.calldataJson ?? null,
      proofReadyAt: input.proofReadyAt ?? null,
      createdAt: input.createdAt ?? nowIso(),
    });

  return requireRow(
    getFdcProof(database, input.fdcProofId),
    `FDC proof ${input.fdcProofId} was not persisted`,
  );
}

export function getFdcProof(
  database: SqliteDatabase,
  fdcProofId: string,
): StoredFdcProofRecord | null {
  const row = database
    .prepare<[string], FdcProofRow>(
      `
SELECT *
FROM fdc_proofs
WHERE fdc_proof_id = ?
`,
    )
    .get(fdcProofId);

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapFdcProofRow(foundRow);
}

export function getFdcProofByRequestAndRound(
  database: SqliteDatabase,
  fdcRequestId: string,
  votingRoundId: bigint,
): StoredFdcProofRecord | null {
  const row = database
    .prepare<[string, string], FdcProofRow>(
      `
SELECT *
FROM fdc_proofs
WHERE fdc_request_id = ?
  AND voting_round_id = ?
`,
    )
    .get(fdcRequestId, serializeBigint(votingRoundId));

  const foundRow = optionalRow(row);
  return foundRow === null ? null : mapFdcProofRow(foundRow);
}

export function listFdcProofsForRedemption(
  database: SqliteDatabase,
  redemptionRequestId: string,
): readonly StoredFdcProofRecord[] {
  const rows = database
    .prepare<[string], FdcProofRow>(
      `
SELECT *
FROM fdc_proofs
WHERE redemption_request_id = ?
ORDER BY voting_round_id ASC
`,
    )
    .all(redemptionRequestId);

  return rows.map(mapFdcProofRow);
}
