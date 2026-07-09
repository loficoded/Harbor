import type { Bytes32, EvmAddress, RedemptionStatus } from "@harbor/shared";

import type { DaLayerFetch, DaLayerRetryOptions } from "../fdc/daLayer.js";
import {
  type FdcHubPublicClient,
  type FdcHubWalletClient,
} from "../fdc/hub.js";
import {
  refreshFdcRequestFinalization,
  retrieveAndPersistReferencedPaymentNonexistenceProof,
  submitStoredFdcRequest,
} from "../fdc/pipeline.js";
import { buildAndPersistReferencedPaymentNonexistenceRequest } from "../fdc/referencedPaymentNonexistence.js";
import type {
  FdcReadContractClient,
  VotingRoundTiming,
} from "../fdc/rounds.js";
import type { SqliteDatabase } from "../db/index.js";
import {
  findRedemptionDefaultEvent,
  getRedemption,
  listFdcProofsForRedemption,
  listFdcRequestsForRedemption,
  listRedemptionsByStatuses,
  listXrplObservationsForRedemption,
  updateRedemptionStatus,
} from "../repositories/index.js";
import type {
  StoredFdcRequestRecord,
  StoredRedemptionRequest,
} from "../repositories/types.js";
import type {
  KeeperFdcClient,
  KeeperRepository,
  RedemptionDefaultConfirmation,
} from "./stateMachine.js";

export function createSqliteKeeperRepository(
  database: SqliteDatabase,
): KeeperRepository {
  return {
    listEligibleRedemptions(input: {
      statuses: readonly RedemptionStatus[];
      limit: number;
    }): readonly StoredRedemptionRequest[] {
      return listRedemptionsByStatuses(database, input.statuses).slice(
        0,
        input.limit,
      );
    },
    getRedemption: (key) => getRedemption(database, key),
    updateRedemptionStatus: (input) => updateRedemptionStatus(database, input),
    listXrplObservations: (redemption) =>
      listXrplObservationsForRedemption(database, redemption.requestId),
    listFdcRequests: (redemption) =>
      listFdcRequestsForRedemption(database, redemption.requestId),
    listFdcProofs: (redemption) =>
      listFdcProofsForRedemption(database, redemption.requestId),
    findDefaultEvent(redemption): RedemptionDefaultConfirmation | null {
      const event = findRedemptionDefaultEvent(database, {
        assetManagerAddress: redemption.assetManagerAddress,
        requestId: redemption.requestId,
      });

      if (event === null) {
        return null;
      }

      return {
        transactionHash: event.transactionHash,
        source: "event",
      };
    },
  };
}

export type SqliteKeeperFdcClientInput = Readonly<{
  database: SqliteDatabase;
  messageIntegrityCode: Bytes32;
  sourceIdName?: string | undefined;
  publicClient: FdcHubPublicClient & FdcReadContractClient;
  walletClient: FdcHubWalletClient;
  relayAddress?: EvmAddress | undefined;
  requestFeeWei?: bigint | undefined;
  fallbackTiming?: VotingRoundTiming | undefined;
  daLayerBaseUrl?: string | undefined;
  daLayerProofPath?: string | undefined;
  daLayerApiKey?: string | undefined;
  daLayerFetch?: DaLayerFetch | undefined;
  daLayerRetry?: DaLayerRetryOptions | undefined;
}>;

export function createSqliteKeeperFdcClient(
  input: SqliteKeeperFdcClientInput,
): KeeperFdcClient {
  return {
    buildOrReuseNonPaymentRequest(parameters): StoredFdcRequestRecord {
      const buildInput = {
        database: input.database,
        assetManagerAddress: parameters.redemption.assetManagerAddress,
        requestId: parameters.redemption.requestId,
        messageIntegrityCode: input.messageIntegrityCode,
        currentUnixTimestamp: parameters.currentUnixTimestamp,
        status: "PENDING",
        createdAt: parameters.createdAt,
        updatedAt: parameters.updatedAt,
        ...(input.sourceIdName === undefined
          ? {}
          : { sourceIdName: input.sourceIdName }),
      } satisfies Parameters<
        typeof buildAndPersistReferencedPaymentNonexistenceRequest
      >[0];
      const result =
        buildAndPersistReferencedPaymentNonexistenceRequest(buildInput);

      if (result.fdcRequest === null) {
        throw new Error("FDC request build unexpectedly returned dry-run");
      }

      return result.fdcRequest;
    },

    submitRequest(parameters): Promise<StoredFdcRequestRecord> {
      if (parameters.request.submissionTransactionHash !== null) {
        return Promise.resolve(parameters.request);
      }

      return submitStoredFdcRequest({
        database: input.database,
        fdcRequestId: parameters.request.fdcRequestId,
        publicClient: input.publicClient,
        walletClient: input.walletClient,
        ...(input.requestFeeWei === undefined
          ? {}
          : { requestFeeWei: input.requestFeeWei }),
        updatedAt: parameters.updatedAt,
      });
    },

    refreshFinalization(parameters): Promise<StoredFdcRequestRecord> {
      return refreshFdcRequestFinalization({
        database: input.database,
        fdcRequestId: parameters.request.fdcRequestId,
        publicClient: input.publicClient,
        ...(input.relayAddress === undefined
          ? {}
          : { relayAddress: input.relayAddress }),
        currentUnixTimestamp: parameters.currentUnixTimestamp,
        updatedAt: parameters.updatedAt,
        ...(input.fallbackTiming === undefined
          ? {}
          : { fallbackTiming: input.fallbackTiming }),
      });
    },

    retrieveProof(parameters) {
      return retrieveAndPersistReferencedPaymentNonexistenceProof({
        database: input.database,
        fdcRequestId: parameters.request.fdcRequestId,
        ...(input.daLayerBaseUrl === undefined
          ? {}
          : { daLayerBaseUrl: input.daLayerBaseUrl }),
        ...(input.daLayerProofPath === undefined
          ? {}
          : { daLayerProofPath: input.daLayerProofPath }),
        ...(input.daLayerApiKey === undefined
          ? {}
          : { daLayerApiKey: input.daLayerApiKey }),
        ...(input.daLayerFetch === undefined
          ? {}
          : { fetch: input.daLayerFetch }),
        ...(input.daLayerRetry === undefined
          ? {}
          : { retry: input.daLayerRetry }),
        proofReadyAt: parameters.proofReadyAt,
      });
    },
  };
}
