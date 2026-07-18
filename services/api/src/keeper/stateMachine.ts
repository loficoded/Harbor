import {
  normalizeBytes32,
  type EvmAddress,
  type IsoTimestamp,
  type RedemptionStatus,
  type TransactionHash,
} from "@harbor/shared";

import type {
  RedemptionKey,
  StoredFdcProofRecord,
  StoredFdcRequestRecord,
  StoredRedemptionRequest,
  StoredXrplPaymentObservation,
  UpdateRedemptionStatusInput,
} from "../repositories/types.js";
import {
  DefaultExecutionRevertedError,
  isLatePaymentFinalizedError,
  type DefaultTransactionReceipt,
  type KeeperDefaultExecutor,
} from "./defaultExecutor.js";

type Awaitable<T> = T | Promise<T>;

export const defaultKeeperBatchSize = 25;
export const defaultKeeperPollingIntervalMs = 30_000;

export const keeperEligibleRedemptionStatuses = [
  "REQUESTED",
  "WATCHING",
  "WINDOW_EXPIRED",
  "REQUEST_PROOF",
  "PROOF_READY",
  "DEFAULT_SUBMITTED",
] as const satisfies readonly RedemptionStatus[];

export type KeeperRepository = Readonly<{
  listEligibleRedemptions(input: {
    statuses: readonly RedemptionStatus[];
    limit: number;
  }): Awaitable<readonly StoredRedemptionRequest[]>;
  getRedemption(key: RedemptionKey): Awaitable<StoredRedemptionRequest | null>;
  updateRedemptionStatus(
    input: UpdateRedemptionStatusInput,
  ): Awaitable<StoredRedemptionRequest>;
  listXrplObservations(
    redemption: StoredRedemptionRequest,
  ): Awaitable<readonly StoredXrplPaymentObservation[]>;
  listFdcRequests(
    redemption: StoredRedemptionRequest,
  ): Awaitable<readonly StoredFdcRequestRecord[]>;
  listFdcProofs(
    redemption: StoredRedemptionRequest,
  ): Awaitable<readonly StoredFdcProofRecord[]>;
  findDefaultEvent(
    redemption: StoredRedemptionRequest,
  ): Awaitable<RedemptionDefaultConfirmation | null>;
}>;

export type RedemptionDefaultConfirmation = Readonly<{
  transactionHash: TransactionHash;
  source: "event" | "receipt";
}>;

export type KeeperFdcClient = Readonly<{
  buildOrReuseNonPaymentRequest(input: {
    redemption: StoredRedemptionRequest;
    currentUnixTimestamp: bigint;
    createdAt: IsoTimestamp;
    updatedAt: IsoTimestamp;
  }): Awaitable<StoredFdcRequestRecord>;
  submitRequest(input: {
    request: StoredFdcRequestRecord;
    updatedAt: IsoTimestamp;
  }): Awaitable<StoredFdcRequestRecord>;
  refreshFinalization(input: {
    request: StoredFdcRequestRecord;
    currentUnixTimestamp: bigint;
    updatedAt: IsoTimestamp;
  }): Awaitable<StoredFdcRequestRecord>;
  retrieveProof(input: {
    request: StoredFdcRequestRecord;
    proofReadyAt: IsoTimestamp;
  }): Awaitable<
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
}>;

export type KeeperClock = Readonly<{
  now(): Date;
}>;

export type KeeperLogLevel = "info" | "warn" | "error";

export type KeeperLogEvent = Readonly<{
  requestId: string;
  assetManagerAddress: EvmAddress;
  status: RedemptionStatus;
  action: string;
  message?: string;
  transactionHash?: TransactionHash | undefined;
  fdcRequestId?: string | undefined;
  error?: string | undefined;
}>;

export type KeeperLogger = Partial<
  Record<KeeperLogLevel, (event: KeeperLogEvent) => void>
>;

export type KeeperStepResult = Readonly<{
  requestId: string;
  assetManagerAddress: EvmAddress;
  fromStatus: RedemptionStatus;
  toStatus: RedemptionStatus;
  action: string;
  changed: boolean;
}>;

export type KeeperBatchSummary = Readonly<{
  processed: number;
  changed: number;
  failed: number;
  results: readonly KeeperStepResult[];
}>;

export type RunKeeperBatchInput = Readonly<{
  repository: KeeperRepository;
  fdcClient: KeeperFdcClient;
  defaultExecutor: KeeperDefaultExecutor;
  clock?: KeeperClock | undefined;
  logger?: KeeperLogger | undefined;
  batchSize?: number | undefined;
  refreshRedemptionState?(redemption: StoredRedemptionRequest): Awaitable<void>;
}>;

export type RunKeeperLoopInput = RunKeeperBatchInput &
  Readonly<{
    pollingIntervalMs?: number | undefined;
    signal?: AbortSignal | undefined;
    sleep?: (milliseconds: number) => Promise<void>;
  }>;

const systemClock: KeeperClock = {
  now: () => new Date(),
};

export async function runKeeperBatch(
  input: RunKeeperBatchInput,
): Promise<KeeperBatchSummary> {
  const clock = input.clock ?? systemClock;
  const batchSize = normalizePositiveInteger(
    input.batchSize ?? defaultKeeperBatchSize,
    "batchSize",
  );
  const redemptions = await input.repository.listEligibleRedemptions({
    statuses: keeperEligibleRedemptionStatuses,
    limit: batchSize,
  });
  const results: KeeperStepResult[] = [];
  let failed = 0;

  for (const redemption of redemptions) {
    try {
      const result = await processKeeperRedemption({
        ...input,
        clock,
        redemption,
      });
      results.push(result);
    } catch (error) {
      failed += 1;
      log(input.logger, "error", redemption, {
        action: "error",
        error: errorMessage(error),
      });
      results.push({
        requestId: redemption.requestId,
        assetManagerAddress: redemption.assetManagerAddress,
        fromStatus: redemption.status,
        toStatus: redemption.status,
        action: "error",
        changed: false,
      });
    }
  }

  return {
    processed: redemptions.length,
    changed: results.filter((result) => result.changed).length,
    failed,
    results,
  };
}

export async function runKeeperLoop(input: RunKeeperLoopInput): Promise<void> {
  const pollingIntervalMs = normalizePositiveInteger(
    input.pollingIntervalMs ?? defaultKeeperPollingIntervalMs,
    "pollingIntervalMs",
  );
  const sleep = input.sleep ?? defaultSleep;

  while (true) {
    if (isSignalAborted(input.signal)) {
      return;
    }

    await runKeeperBatch(input);

    if (isSignalAborted(input.signal)) {
      return;
    }

    await sleep(pollingIntervalMs);
  }
}

export async function processKeeperRedemption(
  input: RunKeeperBatchInput &
    Readonly<{
      redemption: StoredRedemptionRequest;
      clock?: KeeperClock | undefined;
    }>,
): Promise<KeeperStepResult> {
  const clock = input.clock ?? systemClock;
  const current = await latestRedemption(input.repository, input.redemption);
  let defaultConfirmation: RedemptionDefaultConfirmation | null;

  try {
    defaultConfirmation = await findDefaultConfirmation(
      input.repository,
      input.defaultExecutor,
      current,
    );
  } catch (error) {
    if (error instanceof DefaultExecutionRevertedError) {
      return handleDefaultExecutionError(
        { ...input, redemption: current, clock },
        error,
      );
    }

    throw error;
  }

  if (defaultConfirmation !== null) {
    const recovered = await updateStatus(input.repository, current, {
      status: "RECOVERED",
      defaultTransactionHash: defaultConfirmation.transactionHash,
      statusReason: `default-confirmed-by-${defaultConfirmation.source}`,
      updatedAt: nowIso(clock),
    });

    log(input.logger, "info", recovered, {
      action: "recovered",
      transactionHash: defaultConfirmation.transactionHash,
    });

    return step(current, recovered, "recovered");
  }

  const validObservation = await findValidXrplObservation(
    input.repository,
    current,
  );

  if (validObservation !== null) {
    const settled = await updateStatus(input.repository, current, {
      status: "SETTLED",
      transactionHash: validObservation.transactionHash,
      statusReason: "xrpl-payment-observed",
      updatedAt: validObservation.closeTimestamp,
    });

    log(input.logger, "info", settled, {
      action: "settled",
      transactionHash: validObservation.transactionHash,
    });

    return step(current, settled, "settled");
  }

  switch (current.status) {
    case "REQUESTED":
    case "WATCHING":
      return processWatchingRedemption({
        ...input,
        redemption: current,
        clock,
      });
    case "WINDOW_EXPIRED":
      return processWindowExpiredRedemption({
        ...input,
        redemption: current,
        clock,
      });
    case "REQUEST_PROOF":
      return processRequestProofRedemption({
        ...input,
        redemption: current,
        clock,
      });
    case "PROOF_READY":
      return processProofReadyRedemption({
        ...input,
        redemption: current,
        clock,
      });
    case "DEFAULT_SUBMITTED":
      log(input.logger, "info", current, {
        action: "await-default-confirmation",
      });
      return unchanged(current, "await-default-confirmation");
    default:
      return unchanged(current, "ignored");
  }
}

export function isValidXrplObservationForRedemption(
  redemption: StoredRedemptionRequest,
  observation: StoredXrplPaymentObservation,
): boolean {
  if (observation.redemptionRequestId !== redemption.requestId) {
    return false;
  }

  if (
    observation.assetManagerAddress !== null &&
    observation.assetManagerAddress.toLowerCase() !==
      redemption.assetManagerAddress.toLowerCase()
  ) {
    return false;
  }

  if (observation.destinationAddress !== redemption.paymentAddress) {
    return false;
  }

  if (
    normalizeBytes32(observation.paymentReference) !==
    normalizeBytes32(redemption.paymentReference)
  ) {
    return false;
  }

  // A WITH_TAG redemption only settles on an observation whose destination tag
  // matches exactly. Standard redemptions ignore the observed tag.
  if (
    redemption.redemptionKind === "WITH_TAG" &&
    redemption.destinationTag !== null &&
    observation.destinationTag !== redemption.destinationTag
  ) {
    return false;
  }

  if (observation.deliveredAmountUBA < redemption.valueUBA) {
    return false;
  }

  if (
    observation.ledgerIndex < redemption.firstUnderlyingBlock ||
    observation.ledgerIndex > redemption.lastUnderlyingBlock
  ) {
    return false;
  }

  const closeTimestampSeconds = isoTimestampSeconds(observation.closeTimestamp);

  return (
    closeTimestampSeconds !== null &&
    closeTimestampSeconds <= redemption.lastUnderlyingTimestamp
  );
}

function processWatchingRedemption(
  input: RunKeeperBatchInput &
    Readonly<{
      redemption: StoredRedemptionRequest;
      clock: KeeperClock;
    }>,
): Promise<KeeperStepResult> {
  if (!hasPaymentWindowPassed(input.redemption, input.clock)) {
    if (input.redemption.status === "WATCHING") {
      log(input.logger, "info", input.redemption, { action: "watching" });
      return Promise.resolve(unchanged(input.redemption, "watching"));
    }

    return updateStatus(input.repository, input.redemption, {
      status: "WATCHING",
      statusReason: "payment-window-open",
      updatedAt: nowIso(input.clock),
    }).then((watching) => {
      log(input.logger, "info", watching, { action: "watching" });
      return step(input.redemption, watching, "watching");
    });
  }

  return updateStatus(input.repository, input.redemption, {
    status: "WINDOW_EXPIRED",
    statusReason: "payment-window-expired",
    updatedAt: nowIso(input.clock),
  }).then((expired) => {
    log(input.logger, "info", expired, { action: "window-expired" });
    return requestProofForExpiredRedemption({
      ...input,
      redemption: expired,
    });
  });
}

async function processWindowExpiredRedemption(
  input: RunKeeperBatchInput &
    Readonly<{
      redemption: StoredRedemptionRequest;
      clock: KeeperClock;
    }>,
): Promise<KeeperStepResult> {
  return requestProofForExpiredRedemption(input);
}

async function processRequestProofRedemption(
  input: RunKeeperBatchInput &
    Readonly<{
      redemption: StoredRedemptionRequest;
      clock: KeeperClock;
    }>,
): Promise<KeeperStepResult> {
  const request = await getOrBuildFdcRequest(input);
  return advanceFdcRequest(input, request);
}

async function processProofReadyRedemption(
  input: RunKeeperBatchInput &
    Readonly<{
      redemption: StoredRedemptionRequest;
      clock: KeeperClock;
    }>,
): Promise<KeeperStepResult> {
  if (input.redemption.defaultTransactionHash !== null) {
    const submitted = await updateStatus(input.repository, input.redemption, {
      status: "DEFAULT_SUBMITTED",
      statusReason: "default-transaction-already-submitted",
      updatedAt: nowIso(input.clock),
    });

    log(input.logger, "info", submitted, {
      action: "default-already-submitted",
      transactionHash: input.redemption.defaultTransactionHash,
    });

    return step(input.redemption, submitted, "default-already-submitted");
  }

  const proof = await latestFdcProof(input.repository, input.redemption);

  if (proof === null) {
    log(input.logger, "warn", input.redemption, {
      action: "proof-missing",
      message: "PROOF_READY redemption has no persisted FDC proof",
    });
    return unchanged(input.redemption, "proof-missing");
  }

  try {
    const result = await input.defaultExecutor.executeDefault({
      redemption: input.redemption,
      proof,
    });
    const submitted = await updateStatus(input.repository, input.redemption, {
      status: "DEFAULT_SUBMITTED",
      defaultTransactionHash: result.transactionHash,
      statusReason: "default-transaction-submitted",
      updatedAt: nowIso(input.clock),
    });

    log(input.logger, "info", submitted, {
      action: "default-submitted",
      transactionHash: result.transactionHash,
    });

    return step(input.redemption, submitted, "default-submitted");
  } catch (error) {
    return handleDefaultExecutionError(input, error);
  }
}

async function requestProofForExpiredRedemption(
  input: RunKeeperBatchInput &
    Readonly<{
      redemption: StoredRedemptionRequest;
      clock: KeeperClock;
    }>,
): Promise<KeeperStepResult> {
  const request = await getOrBuildFdcRequest(input);
  const advanced = await advanceFdcRequest(input, request);

  if (advanced.toStatus === "PROOF_READY") {
    return advanced;
  }

  if (advanced.toStatus === "REQUEST_PROOF") {
    return step(
      input.redemption,
      advancedRedemption(input.redemption, advanced),
      advanced.action,
    );
  }

  const requested = await updateStatus(input.repository, input.redemption, {
    status: "REQUEST_PROOF",
    statusReason: "fdc-request-created",
    updatedAt: nowIso(input.clock),
  });

  log(input.logger, "info", requested, {
    action: "request-proof",
    fdcRequestId: request.fdcRequestId,
  });

  return step(input.redemption, requested, "request-proof");
}

async function advanceFdcRequest(
  input: RunKeeperBatchInput &
    Readonly<{
      redemption: StoredRedemptionRequest;
      clock: KeeperClock;
    }>,
  request: StoredFdcRequestRecord,
): Promise<KeeperStepResult> {
  if (!isFdcRetryReady(request, input.clock)) {
    log(input.logger, "info", input.redemption, {
      action: "fdc-retry-wait",
      fdcRequestId: request.fdcRequestId,
    });
    return unchanged(input.redemption, "fdc-retry-wait");
  }

  if (
    request.status === "PENDING" ||
    (request.status === "FAILED" && request.votingRoundId === null)
  ) {
    const submitted = await input.fdcClient.submitRequest({
      request,
      updatedAt: nowIso(input.clock),
    });
    const requested = await ensureRequestProofStatus(
      input,
      "fdc-request-submitted",
    );

    log(input.logger, "info", requested, {
      action: "fdc-request-submitted",
      fdcRequestId: submitted.fdcRequestId,
      transactionHash: submitted.submissionTransactionHash ?? undefined,
    });

    return step(input.redemption, requested, "fdc-request-submitted");
  }

  if (request.status === "SUBMITTED") {
    const refreshed = await input.fdcClient.refreshFinalization({
      request,
      currentUnixTimestamp: currentUnixTimestamp(input.clock),
      updatedAt: nowIso(input.clock),
    });

    if (refreshed.status !== "FINALIZED") {
      log(input.logger, "info", input.redemption, {
        action: "fdc-await-finalization",
        fdcRequestId: refreshed.fdcRequestId,
      });
      return unchanged(input.redemption, "fdc-await-finalization");
    }

    log(input.logger, "info", input.redemption, {
      action: "fdc-finalized",
      fdcRequestId: refreshed.fdcRequestId,
    });
    return unchanged(input.redemption, "fdc-finalized");
  }

  if (
    request.status === "FINALIZED" ||
    (request.status === "FAILED" && request.votingRoundId !== null)
  ) {
    const proofResult = await input.fdcClient.retrieveProof({
      request,
      proofReadyAt: nowIso(input.clock),
    });

    if (proofResult.status === "NOT_READY") {
      log(input.logger, "info", input.redemption, {
        action: "fdc-proof-not-ready",
        fdcRequestId: proofResult.fdcRequest.fdcRequestId,
      });
      return unchanged(input.redemption, "fdc-proof-not-ready");
    }

    const proofReady = await updateStatus(input.repository, input.redemption, {
      status: "PROOF_READY",
      statusReason: "fdc-proof-ready",
      updatedAt: nowIso(input.clock),
    });

    log(input.logger, "info", proofReady, {
      action: "proof-ready",
      fdcRequestId: proofResult.fdcRequest.fdcRequestId,
    });

    return step(input.redemption, proofReady, "proof-ready");
  }

  if (request.status === "PROOF_READY") {
    const proofReady = await updateStatus(input.repository, input.redemption, {
      status: "PROOF_READY",
      statusReason: "fdc-proof-ready",
      updatedAt: nowIso(input.clock),
    });

    log(input.logger, "info", proofReady, {
      action: "proof-ready",
      fdcRequestId: request.fdcRequestId,
    });

    return step(input.redemption, proofReady, "proof-ready");
  }

  return unchanged(input.redemption, "request-proof");
}

async function handleDefaultExecutionError(
  input: RunKeeperBatchInput &
    Readonly<{
      redemption: StoredRedemptionRequest;
      clock: KeeperClock;
    }>,
  error: unknown,
): Promise<KeeperStepResult> {
  if (isLatePaymentFinalizedError(error)) {
    await input.refreshRedemptionState?.(input.redemption);

    const refreshed = await latestRedemption(
      input.repository,
      input.redemption,
    );
    const validObservation = await findValidXrplObservation(
      input.repository,
      refreshed,
    );

    if (validObservation !== null || refreshed.status === "SETTLED") {
      const settled =
        refreshed.status === "SETTLED"
          ? refreshed
          : await updateStatus(input.repository, refreshed, {
              status: "SETTLED",
              ...(validObservation === null
                ? {}
                : { transactionHash: validObservation.transactionHash }),
              statusReason: "late-payment-finalized",
              updatedAt:
                validObservation?.closeTimestamp ?? nowIso(input.clock),
            });

      log(input.logger, "warn", settled, {
        action: "late-payment-settled",
        transactionHash: validObservation?.transactionHash,
      });

      return step(input.redemption, settled, "late-payment-settled");
    }

    const failed = await updateStatus(input.repository, refreshed, {
      status: "FAILED",
      statusReason: "default-reverted-late-payment-manual-review",
      updatedAt: nowIso(input.clock),
    });

    log(input.logger, "error", failed, {
      action: "manual-review",
      error: errorMessage(error),
    });

    return step(input.redemption, failed, "manual-review");
  }

  const failed = await updateStatus(input.repository, input.redemption, {
    status: "FAILED",
    statusReason: "default-submit-failed",
    updatedAt: nowIso(input.clock),
  });

  log(input.logger, "error", failed, {
    action: "default-submit-failed",
    error: errorMessage(error),
  });

  return step(input.redemption, failed, "default-submit-failed");
}

async function findDefaultConfirmation(
  repository: KeeperRepository,
  defaultExecutor: KeeperDefaultExecutor,
  redemption: StoredRedemptionRequest,
): Promise<RedemptionDefaultConfirmation | null> {
  const event = await repository.findDefaultEvent(redemption);

  if (event !== null) {
    return event;
  }

  if (
    redemption.defaultTransactionHash === null ||
    defaultExecutor.getTransactionReceipt === undefined
  ) {
    return null;
  }

  const receipt = await defaultExecutor.getTransactionReceipt(
    redemption.defaultTransactionHash,
  );

  if (receipt === null || receipt.status === undefined) {
    return null;
  }

  if (receipt.status === "success") {
    return {
      transactionHash:
        receipt.transactionHash ?? redemption.defaultTransactionHash,
      source: "receipt",
    };
  }

  if (receipt.status === "reverted") {
    throw new DefaultExecutionRevertedError(
      `Submitted default transaction reverted: ${receipt.status}`,
      redemption.defaultTransactionHash,
    );
  }

  return null;
}

async function getOrBuildFdcRequest(
  input: RunKeeperBatchInput &
    Readonly<{
      redemption: StoredRedemptionRequest;
      clock: KeeperClock;
    }>,
): Promise<StoredFdcRequestRecord> {
  const existing = selectFdcRequest(
    await input.repository.listFdcRequests(input.redemption),
  );

  if (existing !== null) {
    return existing;
  }

  const request = await input.fdcClient.buildOrReuseNonPaymentRequest({
    redemption: input.redemption,
    currentUnixTimestamp: currentUnixTimestamp(input.clock),
    createdAt: nowIso(input.clock),
    updatedAt: nowIso(input.clock),
  });

  log(input.logger, "info", input.redemption, {
    action: "fdc-request-created",
    fdcRequestId: request.fdcRequestId,
  });

  return request;
}

function selectFdcRequest(
  requests: readonly StoredFdcRequestRecord[],
): StoredFdcRequestRecord | null {
  if (requests.length === 0) {
    return null;
  }

  return [...requests].sort(compareFdcRequests)[0] ?? null;
}

function compareFdcRequests(
  first: StoredFdcRequestRecord,
  second: StoredFdcRequestRecord,
): number {
  const firstRank = fdcStatusRank(first.status);
  const secondRank = fdcStatusRank(second.status);

  if (firstRank !== secondRank) {
    return firstRank - secondRank;
  }

  return first.createdAt.localeCompare(second.createdAt);
}

function fdcStatusRank(status: StoredFdcRequestRecord["status"]): number {
  switch (status) {
    case "PROOF_READY":
      return 0;
    case "FINALIZED":
      return 1;
    case "SUBMITTED":
      return 2;
    case "PENDING":
      return 3;
    case "FAILED":
      return 4;
  }
}

async function findValidXrplObservation(
  repository: KeeperRepository,
  redemption: StoredRedemptionRequest,
): Promise<StoredXrplPaymentObservation | null> {
  const observations = await repository.listXrplObservations(redemption);

  return (
    observations.find((observation) =>
      isValidXrplObservationForRedemption(redemption, observation),
    ) ?? null
  );
}

async function latestFdcProof(
  repository: KeeperRepository,
  redemption: StoredRedemptionRequest,
): Promise<StoredFdcProofRecord | null> {
  const proofs = await repository.listFdcProofs(redemption);

  return (
    [...proofs].sort((first, second) =>
      first.votingRoundId === second.votingRoundId
        ? 0
        : first.votingRoundId > second.votingRoundId
          ? -1
          : 1,
    )[0] ?? null
  );
}

async function latestRedemption(
  repository: KeeperRepository,
  redemption: StoredRedemptionRequest,
): Promise<StoredRedemptionRequest> {
  return (
    (await repository.getRedemption({
      assetManagerAddress: redemption.assetManagerAddress,
      requestId: redemption.requestId,
    })) ?? redemption
  );
}

async function updateStatus(
  repository: KeeperRepository,
  redemption: StoredRedemptionRequest,
  input: Omit<UpdateRedemptionStatusInput, keyof RedemptionKey>,
): Promise<StoredRedemptionRequest> {
  return repository.updateRedemptionStatus({
    assetManagerAddress: redemption.assetManagerAddress,
    requestId: redemption.requestId,
    ...input,
  });
}

async function ensureRequestProofStatus(
  input: RunKeeperBatchInput &
    Readonly<{
      redemption: StoredRedemptionRequest;
      clock: KeeperClock;
    }>,
  statusReason: string,
): Promise<StoredRedemptionRequest> {
  if (input.redemption.status === "REQUEST_PROOF") {
    return input.redemption;
  }

  return updateStatus(input.repository, input.redemption, {
    status: "REQUEST_PROOF",
    statusReason,
    updatedAt: nowIso(input.clock),
  });
}

function hasPaymentWindowPassed(
  redemption: StoredRedemptionRequest,
  clock: KeeperClock,
): boolean {
  return currentUnixTimestamp(clock) > redemption.lastUnderlyingTimestamp;
}

function currentUnixTimestamp(clock: KeeperClock): bigint {
  return BigInt(Math.floor(clock.now().getTime() / 1_000));
}

function nowIso(clock: KeeperClock): IsoTimestamp {
  return clock.now().toISOString();
}

function isoTimestampSeconds(value: IsoTimestamp): bigint | null {
  const milliseconds = Date.parse(value);

  if (!Number.isFinite(milliseconds)) {
    return null;
  }

  return BigInt(Math.floor(milliseconds / 1_000));
}

function isFdcRetryReady(
  request: StoredFdcRequestRecord,
  clock: KeeperClock,
): boolean {
  if (request.nextRetryAt === null) {
    return true;
  }

  const retryAt = Date.parse(request.nextRetryAt);
  return Number.isFinite(retryAt) && retryAt <= clock.now().getTime();
}

function step(
  from: StoredRedemptionRequest,
  to: StoredRedemptionRequest,
  action: string,
): KeeperStepResult {
  return {
    requestId: from.requestId,
    assetManagerAddress: from.assetManagerAddress,
    fromStatus: from.status,
    toStatus: to.status,
    action,
    changed:
      from.status !== to.status ||
      from.transactionHash !== to.transactionHash ||
      from.defaultTransactionHash !== to.defaultTransactionHash,
  };
}

function unchanged(
  redemption: StoredRedemptionRequest,
  action: string,
): KeeperStepResult {
  return {
    requestId: redemption.requestId,
    assetManagerAddress: redemption.assetManagerAddress,
    fromStatus: redemption.status,
    toStatus: redemption.status,
    action,
    changed: false,
  };
}

function advancedRedemption(
  redemption: StoredRedemptionRequest,
  result: KeeperStepResult,
): StoredRedemptionRequest {
  return {
    ...redemption,
    status: result.toStatus,
  };
}

function log(
  logger: KeeperLogger | undefined,
  level: KeeperLogLevel,
  redemption: StoredRedemptionRequest,
  event: Omit<KeeperLogEvent, "requestId" | "assetManagerAddress" | "status">,
): void {
  logger?.[level]?.({
    requestId: redemption.requestId,
    assetManagerAddress: redemption.assetManagerAddress,
    status: redemption.status,
    ...event,
  });
}

function normalizePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive safe integer`);
  }

  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
