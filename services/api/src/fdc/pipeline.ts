import type { EvmAddress, IsoTimestamp } from "@harbor/shared";

import type { SqliteDatabase } from "../db/index.js";
import {
  getFdcRequest,
  insertFdcProof,
  updateFdcRequestStatus,
} from "../repositories/fdc.js";
import type {
  StoredFdcProofRecord,
  StoredFdcRequestRecord,
} from "../repositories/types.js";
import {
  requestReferencedPaymentNonexistenceProof,
  type DaLayerFetch,
  type DaLayerRetryOptions,
} from "./daLayer.js";
import {
  submitFdcAttestationRequest,
  type FdcHubPublicClient,
  type FdcHubWalletClient,
} from "./hub.js";
import {
  checkFdcVotingRoundFinalization,
  type FdcReadContractClient,
  type VotingRoundTiming,
} from "./rounds.js";

export type SubmitStoredFdcRequestInput = Readonly<{
  database: SqliteDatabase;
  fdcRequestId: string;
  publicClient: FdcHubPublicClient;
  walletClient: FdcHubWalletClient;
  requestFeeWei?: bigint;
  updatedAt?: IsoTimestamp;
}>;

export type RefreshFdcFinalizationInput = Readonly<{
  database: SqliteDatabase;
  fdcRequestId: string;
  publicClient?: FdcReadContractClient | undefined;
  relayAddress?: EvmAddress | undefined;
  currentUnixTimestamp?: bigint;
  updatedAt?: IsoTimestamp;
  fallbackTiming?: VotingRoundTiming;
}>;

export type RetrieveAndPersistFdcProofInput = Readonly<{
  database: SqliteDatabase;
  fdcRequestId: string;
  daLayerBaseUrl?: string;
  daLayerProofPath?: string;
  daLayerApiKey?: string;
  fetch?: DaLayerFetch;
  retry?: DaLayerRetryOptions;
  proofReadyAt?: IsoTimestamp;
}>;

export type RetrieveAndPersistFdcProofResult = Readonly<
  | {
      status: "PROOF_READY";
      fdcRequest: StoredFdcRequestRecord;
      proof: StoredFdcProofRecord;
    }
  | {
      status: "NOT_READY";
      fdcRequest: StoredFdcRequestRecord;
      proof: null;
    }
>;

export async function submitStoredFdcRequest(
  input: SubmitStoredFdcRequestInput,
): Promise<StoredFdcRequestRecord> {
  const request = requireFdcRequest(input.database, input.fdcRequestId);

  try {
    const submitInput = {
      publicClient: input.publicClient,
      walletClient: input.walletClient,
      requestBytes: request.requestBody,
      ...(input.requestFeeWei === undefined
        ? {}
        : { requestFeeWei: input.requestFeeWei }),
    } satisfies Parameters<typeof submitFdcAttestationRequest>[0];
    const submission = await submitFdcAttestationRequest(submitInput);

    return updateFdcRequestStatus(input.database, {
      fdcRequestId: request.fdcRequestId,
      status: "SUBMITTED",
      votingRoundId: submission.votingRoundId,
      submissionTransactionHash: submission.transactionHash,
      lastError: null,
      retryCount: 0,
      nextRetryAt: null,
      ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
    });
  } catch (error) {
    recordFdcRequestRetry(input.database, request, errorMessage(error), {
      status: "FAILED",
      updatedAt: input.updatedAt,
    });
    throw error;
  }
}

export async function refreshFdcRequestFinalization(
  input: RefreshFdcFinalizationInput,
): Promise<StoredFdcRequestRecord> {
  const request = requireFdcRequest(input.database, input.fdcRequestId);

  if (request.votingRoundId === null) {
    throw new Error(
      `FDC request ${request.fdcRequestId} has no voting round id`,
    );
  }

  const finalization = await checkFdcVotingRoundFinalization({
    publicClient: input.publicClient,
    relayAddress: input.relayAddress,
    votingRoundId: request.votingRoundId,
    currentUnixTimestamp: input.currentUnixTimestamp,
    fallbackTiming: input.fallbackTiming,
  });

  if (finalization.isFinalized) {
    return updateFdcRequestStatus(input.database, {
      fdcRequestId: request.fdcRequestId,
      status: "FINALIZED",
      lastError: null,
      nextRetryAt: null,
      ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
    });
  }

  return updateFdcRequestStatus(input.database, {
    fdcRequestId: request.fdcRequestId,
    status: request.status,
    lastError:
      finalization.lastError ??
      `FDC voting round ${request.votingRoundId.toString()} is not finalized`,
    nextRetryAt: retryTimestamp(input.updatedAt),
    ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
  });
}

export async function retrieveAndPersistReferencedPaymentNonexistenceProof(
  input: RetrieveAndPersistFdcProofInput,
): Promise<RetrieveAndPersistFdcProofResult> {
  const request = requireFdcRequest(input.database, input.fdcRequestId);

  if (request.votingRoundId === null) {
    throw new Error(
      `FDC request ${request.fdcRequestId} has no voting round id`,
    );
  }

  try {
    const proofResult = await requestReferencedPaymentNonexistenceProof({
      votingRoundId: request.votingRoundId,
      requestBytes: request.requestBody,
      ...(input.daLayerBaseUrl === undefined
        ? {}
        : { baseUrl: input.daLayerBaseUrl }),
      ...(input.daLayerProofPath === undefined
        ? {}
        : { proofPath: input.daLayerProofPath }),
      ...(input.daLayerApiKey === undefined
        ? {}
        : { apiKey: input.daLayerApiKey }),
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      ...(input.retry === undefined ? {} : { retry: input.retry }),
    });

    if (proofResult.status === "NOT_READY") {
      const updatedRequest = recordFdcRequestRetry(
        input.database,
        request,
        proofResult.lastError,
        {
          status: request.status,
          updatedAt: input.proofReadyAt,
        },
      );

      return {
        status: "NOT_READY",
        fdcRequest: updatedRequest,
        proof: null,
      };
    }

    const proofReadyAt = input.proofReadyAt ?? new Date().toISOString();
    const proof = insertFdcProof(input.database, {
      fdcProofId: fdcProofId(request.fdcRequestId, request.votingRoundId),
      fdcRequestId: request.fdcRequestId,
      redemptionRequestId: request.redemptionRequestId,
      assetManagerAddress: request.assetManagerAddress,
      requestHash: request.requestHash,
      responseBody: proofResult.encodedResponse,
      merkleProof: proofResult.proofCalldata.merkleProof,
      votingRoundId: request.votingRoundId,
      proofJson: proofResult.proofJson,
      calldataJson: proofResult.calldataJson,
      proofReadyAt,
      createdAt: proofReadyAt,
    });
    const updatedRequest = updateFdcRequestStatus(input.database, {
      fdcRequestId: request.fdcRequestId,
      status: "PROOF_READY",
      lastError: null,
      retryCount: 0,
      nextRetryAt: null,
      updatedAt: proofReadyAt,
    });

    return {
      status: "PROOF_READY",
      fdcRequest: updatedRequest,
      proof,
    };
  } catch (error) {
    recordFdcRequestRetry(input.database, request, errorMessage(error), {
      status: "FAILED",
      updatedAt: input.proofReadyAt,
    });
    throw error;
  }
}

export function calculateFdcRetryDelayMs(
  retryCount: number,
  baseDelayMs = 60_000,
  maxDelayMs = 15 * 60_000,
): number {
  const exponent = Math.min(Math.max(retryCount, 0), 10);
  return Math.min(baseDelayMs * 2 ** exponent, maxDelayMs);
}

function recordFdcRequestRetry(
  database: SqliteDatabase,
  request: StoredFdcRequestRecord,
  lastError: string,
  options: {
    status: StoredFdcRequestRecord["status"];
    updatedAt?: IsoTimestamp | undefined;
  },
): StoredFdcRequestRecord {
  const retryCount = request.retryCount + 1;

  return updateFdcRequestStatus(database, {
    fdcRequestId: request.fdcRequestId,
    status: options.status,
    lastError,
    retryCount,
    nextRetryAt: retryTimestamp(options.updatedAt, retryCount),
    ...(options.updatedAt === undefined
      ? {}
      : { updatedAt: options.updatedAt }),
  });
}

function retryTimestamp(
  fromTimestamp?: IsoTimestamp | undefined,
  retryCount = 1,
): IsoTimestamp {
  const from =
    fromTimestamp === undefined ? new Date() : new Date(fromTimestamp);
  return new Date(
    from.getTime() + calculateFdcRetryDelayMs(retryCount - 1),
  ).toISOString();
}

function requireFdcRequest(
  database: SqliteDatabase,
  fdcRequestId: string,
): StoredFdcRequestRecord {
  const request = getFdcRequest(database, fdcRequestId);

  if (request === null) {
    throw new Error(`FDC request ${fdcRequestId} does not exist`);
  }

  return request;
}

function fdcProofId(fdcRequestId: string, votingRoundId: bigint): string {
  return `${fdcRequestId}:proof:${votingRoundId.toString()}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
