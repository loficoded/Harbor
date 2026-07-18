import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type {
  Bytes32,
  EvmAddress,
  IsoTimestamp,
  RedemptionStatus,
  TransactionHash,
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
  buildExecuteDefaultParameters,
  LatePaymentFinalizedError,
  type DefaultTransactionReceipt,
  type ExecuteHarborDefaultInput,
  type ExecuteHarborDefaultResult,
  type KeeperDefaultExecutor,
} from "./defaultExecutor.js";
import { xrpPaymentNonexistenceAttestationType } from "../fdc/xrpPaymentNonexistence.js";
import {
  processKeeperRedemption,
  runKeeperBatch,
  type KeeperClock,
  type KeeperFdcClient,
  type KeeperRepository,
  type RedemptionDefaultConfirmation,
} from "./stateMachine.js";

const assetManagerAddress = `0x${"11".repeat(20)}` as EvmAddress;
const harborRedeemerAddress = `0x${"12".repeat(20)}` as EvmAddress;
const agentVault = `0x${"22".repeat(20)}` as EvmAddress;
const redeemer = `0x${"33".repeat(20)}` as EvmAddress;
const executor = `0x${"44".repeat(20)}` as EvmAddress;
const sourceTransactionHash = `0x${"aa".repeat(32)}` as TransactionHash;
const xrplTransactionHash = `0x${"bb".repeat(32)}` as TransactionHash;
const defaultTransactionHash = `0x${"cc".repeat(32)}` as TransactionHash;
const fdcSubmissionHash = `0x${"dd".repeat(32)}` as TransactionHash;
const paymentReference = `0x${"ee".repeat(32)}` as Bytes32;
const requestHash = `0x${"ab".repeat(32)}` as Bytes32;
const attestationType = `0x${"01".repeat(32)}` as Bytes32;
const attestationTypeBase = attestationType;
const xrpAttestationType = xrpPaymentNonexistenceAttestationType;
const sourceId = `0x${"02".repeat(32)}` as Bytes32;
const proofNode = `0x${"03".repeat(32)}` as Bytes32;
const zeroBytes32 = `0x${"00".repeat(32)}` as Bytes32;
const deadlineIso = "2026-07-08T00:00:00.000Z";
const deadlineSeconds = BigInt(Date.parse(deadlineIso) / 1_000);
const beforeDeadlineClock = fakeClock("2026-07-07T23:59:59.000Z");
const afterDeadlineClock = fakeClock("2026-07-08T00:00:01.000Z");

class FakeRepository implements KeeperRepository {
  readonly redemptions = new Map<string, StoredRedemptionRequest>();
  readonly observations: StoredXrplPaymentObservation[] = [];
  readonly fdcRequests: StoredFdcRequestRecord[] = [];
  readonly fdcProofs: StoredFdcProofRecord[] = [];
  readonly defaultConfirmations = new Map<
    string,
    RedemptionDefaultConfirmation
  >();

  insertRedemption(
    redemption: StoredRedemptionRequest,
  ): StoredRedemptionRequest {
    this.redemptions.set(redemptionKey(redemption), redemption);
    return redemption;
  }

  insertObservation(
    observation: StoredXrplPaymentObservation,
  ): StoredXrplPaymentObservation {
    this.observations.push(observation);
    return observation;
  }

  upsertFdcRequest(request: StoredFdcRequestRecord): StoredFdcRequestRecord {
    const index = this.fdcRequests.findIndex(
      (entry) => entry.fdcRequestId === request.fdcRequestId,
    );

    if (index < 0) {
      this.fdcRequests.push(request);
    } else {
      this.fdcRequests[index] = request;
    }

    return request;
  }

  insertProof(proof: StoredFdcProofRecord): StoredFdcProofRecord {
    if (
      !this.fdcProofs.some((entry) => entry.fdcProofId === proof.fdcProofId)
    ) {
      this.fdcProofs.push(proof);
    }

    return proof;
  }

  confirmDefault(
    redemption: StoredRedemptionRequest,
    confirmation: RedemptionDefaultConfirmation,
  ): void {
    this.defaultConfirmations.set(redemptionKey(redemption), confirmation);
  }

  listEligibleRedemptions(input: {
    statuses: readonly RedemptionStatus[];
    limit: number;
  }): readonly StoredRedemptionRequest[] {
    return [...this.redemptions.values()]
      .filter((redemption) => input.statuses.includes(redemption.status))
      .slice(0, input.limit);
  }

  getRedemption(key: RedemptionKey): StoredRedemptionRequest | null {
    return this.redemptions.get(redemptionKey(key)) ?? null;
  }

  updateRedemptionStatus(
    input: UpdateRedemptionStatusInput,
  ): StoredRedemptionRequest {
    const current = this.getRedemption(input);

    if (current === null) {
      throw new Error(`missing redemption ${redemptionKey(input)}`);
    }

    const updated: StoredRedemptionRequest = {
      ...current,
      status: input.status,
      transactionHash:
        input.transactionHash === undefined
          ? current.transactionHash
          : input.transactionHash,
      defaultTransactionHash:
        input.defaultTransactionHash === undefined
          ? current.defaultTransactionHash
          : input.defaultTransactionHash,
      statusReason:
        input.statusReason === undefined
          ? current.statusReason
          : input.statusReason,
      updatedAt: input.updatedAt ?? current.updatedAt,
    };

    this.redemptions.set(redemptionKey(updated), updated);
    return updated;
  }

  listXrplObservations(
    redemption: StoredRedemptionRequest,
  ): readonly StoredXrplPaymentObservation[] {
    return this.observations.filter(
      (observation) =>
        observation.redemptionRequestId === redemption.requestId &&
        (observation.assetManagerAddress === null ||
          observation.assetManagerAddress === redemption.assetManagerAddress),
    );
  }

  listFdcRequests(
    redemption: StoredRedemptionRequest,
  ): readonly StoredFdcRequestRecord[] {
    return this.fdcRequests.filter(
      (request) =>
        request.redemptionRequestId === redemption.requestId &&
        (request.assetManagerAddress === null ||
          request.assetManagerAddress === redemption.assetManagerAddress),
    );
  }

  listFdcProofs(
    redemption: StoredRedemptionRequest,
  ): readonly StoredFdcProofRecord[] {
    return this.fdcProofs.filter(
      (proof) =>
        proof.redemptionRequestId === redemption.requestId &&
        (proof.assetManagerAddress === null ||
          proof.assetManagerAddress === redemption.assetManagerAddress),
    );
  }

  findDefaultEvent(
    redemption: StoredRedemptionRequest,
  ): RedemptionDefaultConfirmation | null {
    return this.defaultConfirmations.get(redemptionKey(redemption)) ?? null;
  }
}

class FakeFdcClient implements KeeperFdcClient {
  buildCalls = 0;
  submitCalls = 0;
  refreshCalls = 0;
  retrieveCalls = 0;
  retrieveResults: ("NOT_READY" | "PROOF_READY")[] = ["PROOF_READY"];
  refreshFinalizes = false;
  lastBuildRedemptionKind: StoredRedemptionRequest["redemptionKind"] | null =
    null;
  lastBuildAttestationType: Bytes32 | null = null;

  constructor(private readonly repository: FakeRepository) {}

  buildOrReuseNonPaymentRequest(input: {
    redemption: StoredRedemptionRequest;
    createdAt: IsoTimestamp;
    updatedAt: IsoTimestamp;
  }): StoredFdcRequestRecord {
    this.buildCalls += 1;
    this.lastBuildRedemptionKind = input.redemption.redemptionKind;
    const existing = this.repository.listFdcRequests(input.redemption)[0];

    if (existing !== undefined) {
      return existing;
    }

    const attestationType =
      input.redemption.redemptionKind === "WITH_TAG"
        ? xrpAttestationType
        : attestationTypeBase;
    this.lastBuildAttestationType = attestationType;

    return this.repository.upsertFdcRequest(
      fdcRequestFixture(input.redemption, {
        status: "PENDING",
        attestationType,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      }),
    );
  }

  submitRequest(input: {
    request: StoredFdcRequestRecord;
    updatedAt: IsoTimestamp;
  }): StoredFdcRequestRecord {
    this.submitCalls += 1;
    return this.repository.upsertFdcRequest({
      ...input.request,
      status: "SUBMITTED",
      votingRoundId: input.request.votingRoundId ?? 7n,
      submissionTransactionHash:
        input.request.submissionTransactionHash ?? fdcSubmissionHash,
      lastError: null,
      retryCount: 0,
      nextRetryAt: null,
      updatedAt: input.updatedAt,
    });
  }

  refreshFinalization(input: {
    request: StoredFdcRequestRecord;
    updatedAt: IsoTimestamp;
  }): StoredFdcRequestRecord {
    this.refreshCalls += 1;
    return this.repository.upsertFdcRequest({
      ...input.request,
      status: this.refreshFinalizes ? "FINALIZED" : input.request.status,
      lastError: this.refreshFinalizes ? null : "round not finalized",
      nextRetryAt: this.refreshFinalizes ? null : "2026-07-08T00:01:01.000Z",
      updatedAt: input.updatedAt,
    });
  }

  retrieveProof(input: {
    request: StoredFdcRequestRecord;
    proofReadyAt: IsoTimestamp;
  }):
    | {
        status: "PROOF_READY";
        fdcRequest: StoredFdcRequestRecord;
        proof: StoredFdcProofRecord;
      }
    | {
        status: "NOT_READY";
        fdcRequest: StoredFdcRequestRecord;
        proof: null;
      } {
    this.retrieveCalls += 1;
    const next = this.retrieveResults.shift() ?? "PROOF_READY";

    if (next === "NOT_READY") {
      const request = this.repository.upsertFdcRequest({
        ...input.request,
        lastError: "temporary DA failure",
        retryCount: input.request.retryCount + 1,
        nextRetryAt: "2026-07-08T00:02:00.000Z",
        updatedAt: input.proofReadyAt,
      });

      return { status: "NOT_READY", fdcRequest: request, proof: null };
    }

    const request = this.repository.upsertFdcRequest({
      ...input.request,
      status: "PROOF_READY",
      lastError: null,
      retryCount: 0,
      nextRetryAt: null,
      updatedAt: input.proofReadyAt,
    });
    const proof = this.repository.insertProof(proofFixture(request));

    return { status: "PROOF_READY", fdcRequest: request, proof };
  }
}

class FakeDefaultExecutor implements KeeperDefaultExecutor {
  executeCalls = 0;
  error: unknown = null;
  readonly receipts = new Map<
    TransactionHash,
    DefaultTransactionReceipt | null
  >();

  async executeDefault(
    input: ExecuteHarborDefaultInput,
  ): Promise<ExecuteHarborDefaultResult> {
    assert.equal(input.proof.redemptionRequestId, input.redemption.requestId);
    this.executeCalls += 1;

    if (this.error !== null) {
      throw this.error;
    }

    return { transactionHash: defaultTransactionHash };
  }

  async getTransactionReceipt(
    transactionHash: TransactionHash,
  ): Promise<DefaultTransactionReceipt | null> {
    return this.receipts.get(transactionHash) ?? null;
  }
}

describe("keeper redemption state machine", () => {
  test("moves requested redemptions into watching while the payment window is open", async () => {
    const repository = new FakeRepository();
    const redemption = repository.insertRedemption(
      redemptionFixture({ status: "REQUESTED" }),
    );
    const result = await processKeeperRedemption({
      repository,
      fdcClient: new FakeFdcClient(repository),
      defaultExecutor: new FakeDefaultExecutor(),
      redemption,
      clock: beforeDeadlineClock,
    });

    assert.equal(result.fromStatus, "REQUESTED");
    assert.equal(result.toStatus, "WATCHING");
    assert.equal(result.action, "watching");
    assert.equal(repository.getRedemption(redemption)?.status, "WATCHING");
  });

  test("settles watching redemptions after a valid persisted XRPL observation", async () => {
    const repository = new FakeRepository();
    const redemption = repository.insertRedemption(
      redemptionFixture({ status: "WATCHING" }),
    );
    repository.insertObservation(xrplObservationFixture(redemption));

    const result = await processKeeperRedemption({
      repository,
      fdcClient: new FakeFdcClient(repository),
      defaultExecutor: new FakeDefaultExecutor(),
      redemption,
      clock: beforeDeadlineClock,
    });
    const stored = repository.getRedemption(redemption);

    assert.equal(result.toStatus, "SETTLED");
    assert.equal(stored?.status, "SETTLED");
    assert.equal(stored?.transactionHash, xrplTransactionHash);
  });

  test("builds and submits an FDC request after the payment deadline", async () => {
    const repository = new FakeRepository();
    const fdcClient = new FakeFdcClient(repository);
    const redemption = repository.insertRedemption(
      redemptionFixture({ status: "WATCHING" }),
    );

    const result = await processKeeperRedemption({
      repository,
      fdcClient,
      defaultExecutor: new FakeDefaultExecutor(),
      redemption,
      clock: afterDeadlineClock,
    });
    const stored = repository.getRedemption(redemption);

    assert.equal(result.toStatus, "REQUEST_PROOF");
    assert.equal(stored?.status, "REQUEST_PROOF");
    assert.equal(repository.fdcRequests.length, 1);
    assert.equal(repository.fdcRequests[0]?.status, "SUBMITTED");
    assert.equal(fdcClient.buildCalls, 1);
    assert.equal(fdcClient.submitCalls, 1);
  });

  test("moves request proof redemptions to proof ready when DA proof is available", async () => {
    const repository = new FakeRepository();
    const fdcClient = new FakeFdcClient(repository);
    const redemption = repository.insertRedemption(
      redemptionFixture({ status: "REQUEST_PROOF" }),
    );
    repository.upsertFdcRequest(
      fdcRequestFixture(redemption, {
        status: "FINALIZED",
        votingRoundId: 7n,
      }),
    );

    const result = await processKeeperRedemption({
      repository,
      fdcClient,
      defaultExecutor: new FakeDefaultExecutor(),
      redemption,
      clock: afterDeadlineClock,
    });

    assert.equal(result.toStatus, "PROOF_READY");
    assert.equal(repository.getRedemption(redemption)?.status, "PROOF_READY");
    assert.equal(repository.fdcProofs.length, 1);
    assert.equal(fdcClient.retrieveCalls, 1);
  });

  test("submits executeDefault once proof is ready", async () => {
    const repository = new FakeRepository();
    const defaultExecutor = new FakeDefaultExecutor();
    const redemption = repository.insertRedemption(
      redemptionFixture({ status: "PROOF_READY" }),
    );
    const request = repository.upsertFdcRequest(
      fdcRequestFixture(redemption, { status: "PROOF_READY" }),
    );
    repository.insertProof(proofFixture(request));

    const result = await processKeeperRedemption({
      repository,
      fdcClient: new FakeFdcClient(repository),
      defaultExecutor,
      redemption,
      clock: afterDeadlineClock,
    });
    const stored = repository.getRedemption(redemption);

    assert.equal(result.toStatus, "DEFAULT_SUBMITTED");
    assert.equal(stored?.defaultTransactionHash, defaultTransactionHash);
    assert.equal(defaultExecutor.executeCalls, 1);
  });

  test("recovers default submitted redemptions from a successful receipt", async () => {
    const repository = new FakeRepository();
    const defaultExecutor = new FakeDefaultExecutor();
    const redemption = repository.insertRedemption(
      redemptionFixture({
        status: "DEFAULT_SUBMITTED",
        defaultTransactionHash,
      }),
    );
    defaultExecutor.receipts.set(defaultTransactionHash, {
      status: "success",
      transactionHash: defaultTransactionHash,
    });

    const result = await processKeeperRedemption({
      repository,
      fdcClient: new FakeFdcClient(repository),
      defaultExecutor,
      redemption,
      clock: afterDeadlineClock,
    });

    assert.equal(result.toStatus, "RECOVERED");
    assert.equal(repository.getRedemption(redemption)?.status, "RECOVERED");
  });

  test("retries proof polling after a temporary DA failure", async () => {
    const repository = new FakeRepository();
    const fdcClient = new FakeFdcClient(repository);
    fdcClient.retrieveResults = ["NOT_READY", "PROOF_READY"];
    const redemption = repository.insertRedemption(
      redemptionFixture({ status: "REQUEST_PROOF" }),
    );
    repository.upsertFdcRequest(
      fdcRequestFixture(redemption, {
        status: "FINALIZED",
        votingRoundId: 7n,
      }),
    );

    const first = await processKeeperRedemption({
      repository,
      fdcClient,
      defaultExecutor: new FakeDefaultExecutor(),
      redemption,
      clock: afterDeadlineClock,
    });
    assert.equal(first.toStatus, "REQUEST_PROOF");
    assert.equal(fdcClient.retrieveCalls, 1);

    const second = await processKeeperRedemption({
      repository,
      fdcClient,
      defaultExecutor: new FakeDefaultExecutor(),
      redemption: repository.getRedemption(redemption)!,
      clock: fakeClock("2026-07-08T00:02:01.000Z"),
    });

    assert.equal(second.toStatus, "PROOF_READY");
    assert.equal(fdcClient.retrieveCalls, 2);
  });

  test("does not duplicate an already submitted default transaction", async () => {
    const repository = new FakeRepository();
    const defaultExecutor = new FakeDefaultExecutor();
    const redemption = repository.insertRedemption(
      redemptionFixture({
        status: "PROOF_READY",
        defaultTransactionHash,
      }),
    );
    const request = repository.upsertFdcRequest(
      fdcRequestFixture(redemption, { status: "PROOF_READY" }),
    );
    repository.insertProof(proofFixture(request));

    await processKeeperRedemption({
      repository,
      fdcClient: new FakeFdcClient(repository),
      defaultExecutor,
      redemption,
      clock: afterDeadlineClock,
    });
    await processKeeperRedemption({
      repository,
      fdcClient: new FakeFdcClient(repository),
      defaultExecutor,
      redemption: repository.getRedemption(redemption)!,
      clock: afterDeadlineClock,
    });

    assert.equal(defaultExecutor.executeCalls, 0);
    assert.equal(
      repository.getRedemption(redemption)?.status,
      "DEFAULT_SUBMITTED",
    );
  });

  test("refreshes state and settles instead of retrying after a late-payment revert", async () => {
    const repository = new FakeRepository();
    const defaultExecutor = new FakeDefaultExecutor();
    defaultExecutor.error = new LatePaymentFinalizedError();
    const redemption = repository.insertRedemption(
      redemptionFixture({ status: "PROOF_READY" }),
    );
    const request = repository.upsertFdcRequest(
      fdcRequestFixture(redemption, { status: "PROOF_READY" }),
    );
    repository.insertProof(proofFixture(request));

    const result = await processKeeperRedemption({
      repository,
      fdcClient: new FakeFdcClient(repository),
      defaultExecutor,
      redemption,
      clock: afterDeadlineClock,
      refreshRedemptionState: (refreshedRedemption) => {
        repository.insertObservation(
          xrplObservationFixture(refreshedRedemption, {
            transactionHash: `0x${"f1".repeat(32)}` as TransactionHash,
          }),
        );
      },
    });

    assert.equal(result.toStatus, "SETTLED");
    assert.equal(repository.getRedemption(redemption)?.status, "SETTLED");
    assert.equal(defaultExecutor.executeCalls, 1);
  });

  test("uses fake clock boundaries for deadline behavior", async () => {
    const repository = new FakeRepository();
    const fdcClient = new FakeFdcClient(repository);
    const redemption = repository.insertRedemption(
      redemptionFixture({ status: "REQUESTED" }),
    );

    await processKeeperRedemption({
      repository,
      fdcClient,
      defaultExecutor: new FakeDefaultExecutor(),
      redemption,
      clock: fakeClock(deadlineIso),
    });
    assert.equal(repository.getRedemption(redemption)?.status, "WATCHING");

    await processKeeperRedemption({
      repository,
      fdcClient,
      defaultExecutor: new FakeDefaultExecutor(),
      redemption: repository.getRedemption(redemption)!,
      clock: afterDeadlineClock,
    });

    assert.equal(repository.getRedemption(redemption)?.status, "REQUEST_PROOF");
  });

  test("running the keeper twice does not duplicate FDC submissions", async () => {
    const repository = new FakeRepository();
    const fdcClient = new FakeFdcClient(repository);
    repository.insertRedemption(redemptionFixture({ status: "WATCHING" }));

    await runKeeperBatch({
      repository,
      fdcClient,
      defaultExecutor: new FakeDefaultExecutor(),
      clock: afterDeadlineClock,
    });
    await runKeeperBatch({
      repository,
      fdcClient,
      defaultExecutor: new FakeDefaultExecutor(),
      clock: afterDeadlineClock,
    });

    assert.equal(repository.fdcRequests.length, 1);
    assert.equal(fdcClient.submitCalls, 1);
  });

  test("default submission uses permissionless executeDefault, not owner functions", () => {
    const redemption = redemptionFixture({ status: "PROOF_READY" });
    const request = fdcRequestFixture(redemption, { status: "PROOF_READY" });
    const parameters = buildExecuteDefaultParameters({
      harborRedeemerAddress,
      redemption,
      proof: proofFixture(request),
    });

    assert.equal(parameters.functionName, "executeDefault");
    assert.notEqual(parameters.functionName, "setDefaultKeeperExecutor");
    assert.notEqual(parameters.functionName, "transferOwnership");
  });

  test("WITH_TAG redemption selects executeXrpDefault with XRP proof calldata", () => {
    const redemption = redemptionFixture({
      status: "PROOF_READY",
      redemptionKind: "WITH_TAG",
      destinationTag: 777n,
    });
    const request = fdcRequestFixture(redemption, {
      status: "PROOF_READY",
      attestationType: xrpAttestationType,
    });
    const parameters = buildExecuteDefaultParameters({
      harborRedeemerAddress,
      redemption,
      proof: xrpProofFixture(request),
    });

    assert.equal(parameters.functionName, "executeXrpDefault");
    assert.notEqual(parameters.functionName, "executeDefault");
    // The XRP request body (10 fields incl. destinationTag) is forwarded.
    assert.equal(parameters.args[1], 42n);
    assert.equal(parameters.args[0].data.requestBody.destinationTag, 777n);
  });

  test("STANDARD redemption with an XRP-shaped proof still routes to executeDefault (kind gates the lane)", () => {
    // The redemptionKind — not the proof shape — selects the entrypoint, so a
    // kind/proof mismatch is caught by the on-chain verifier rather than
    // silently routing to the wrong default.
    const redemption = redemptionFixture({
      status: "PROOF_READY",
      redemptionKind: "STANDARD",
      destinationTag: null,
    });
    const request = fdcRequestFixture(redemption, { status: "PROOF_READY" });
    const parameters = buildExecuteDefaultParameters({
      harborRedeemerAddress,
      redemption,
      proof: proofFixture(request),
    });

    assert.equal(parameters.functionName, "executeDefault");
  });

  test("WITH_TAG redemption builds an XRP attestation request when the window expires", async () => {
    const repository = new FakeRepository();
    const redemption = repository.insertRedemption(
      redemptionFixture({
        status: "WATCHING",
        redemptionKind: "WITH_TAG",
        destinationTag: 4242n,
      }),
    );
    const fdcClient = new FakeFdcClient(repository);

    const result = await processKeeperRedemption({
      repository,
      fdcClient,
      defaultExecutor: new FakeDefaultExecutor(),
      redemption,
      clock: afterDeadlineClock,
    });

    assert.equal(result.toStatus, "REQUEST_PROOF");
    assert.equal(fdcClient.lastBuildRedemptionKind, "WITH_TAG");
    assert.equal(fdcClient.lastBuildAttestationType, xrpAttestationType);
  });

  test("WITH_TAG redemption at PROOF_READY submits the default and reaches DEFAULT_SUBMITTED", async () => {
    const repository = new FakeRepository();
    const defaultExecutor = new FakeDefaultExecutor();
    const redemption = repository.insertRedemption(
      redemptionFixture({
        status: "PROOF_READY",
        redemptionKind: "WITH_TAG",
        destinationTag: 4242n,
      }),
    );
    const request = repository.upsertFdcRequest(
      fdcRequestFixture(redemption, {
        status: "PROOF_READY",
        attestationType: xrpAttestationType,
      }),
    );
    repository.insertProof(xrpProofFixture(request));

    const result = await processKeeperRedemption({
      repository,
      fdcClient: new FakeFdcClient(repository),
      defaultExecutor,
      redemption,
      clock: afterDeadlineClock,
    });

    assert.equal(result.toStatus, "DEFAULT_SUBMITTED");
    assert.equal(defaultExecutor.executeCalls, 1);
    assert.equal(
      repository.getRedemption(redemption)?.defaultTransactionHash,
      defaultTransactionHash,
    );
  });
});

function fakeClock(isoTimestamp: IsoTimestamp): KeeperClock {
  return {
    now: () => new Date(isoTimestamp),
  };
}

function redemptionKey(key: RedemptionKey): string {
  return `${key.assetManagerAddress.toLowerCase()}:${key.requestId}`;
}

function redemptionFixture(
  overrides: Partial<StoredRedemptionRequest> = {},
): StoredRedemptionRequest {
  return {
    assetManagerAddress,
    requestId: "42",
    sourceChainId: "114",
    sourceBlockNumber: "1000",
    sourceLogIndex: "7",
    sourceTransactionHash,
    transactionHash: null,
    redeemer,
    agentVault,
    paymentAddress: "rDestinationAddress",
    valueUBA: 1_000_000n,
    feeUBA: 10n,
    paymentReference,
    firstUnderlyingBlock: 100n,
    lastUnderlyingBlock: 200n,
    lastUnderlyingTimestamp: deadlineSeconds,
    executor,
    executorFeeNatWei: 55n,
    status: "REQUESTED",
    defaultTransactionHash: null,
    statusReason: null,
    redemptionKind: "STANDARD",
    destinationTag: null,
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    ...overrides,
  };
}

function xrplObservationFixture(
  redemption: StoredRedemptionRequest,
  overrides: Partial<StoredXrplPaymentObservation> = {},
): StoredXrplPaymentObservation {
  return {
    observationId: `xrpl:${redemption.requestId}`,
    redemptionRequestId: redemption.requestId,
    assetManagerAddress: redemption.assetManagerAddress,
    transactionHash: xrplTransactionHash,
    sourceAddress: "rSourceAddress",
    destinationAddress: redemption.paymentAddress,
    deliveredAmountUBA: redemption.valueUBA,
    feeDrops: 12n,
    paymentReference: redemption.paymentReference,
    ledgerIndex: 150n,
    closeTimestamp: deadlineIso,
    validatedAt: deadlineIso,
    destinationTag: null,
    rawJson: null,
    createdAt: deadlineIso,
    ...overrides,
  };
}

function fdcRequestFixture(
  redemption: StoredRedemptionRequest,
  overrides: Partial<StoredFdcRequestRecord> = {},
): StoredFdcRequestRecord {
  return {
    fdcRequestId: "referenced-payment-nonexistence:test",
    redemptionRequestId: redemption.requestId,
    assetManagerAddress: redemption.assetManagerAddress,
    attestationType,
    sourceId,
    sourceChainId: redemption.sourceChainId,
    requestBody: "0x1234",
    requestHash,
    status: "PENDING",
    votingRoundId: null,
    submissionTransactionHash: null,
    lastError: null,
    retryCount: 0,
    nextRetryAt: null,
    createdAt: "2026-07-08T00:00:01.000Z",
    updatedAt: "2026-07-08T00:00:01.000Z",
    ...overrides,
  };
}

function proofFixture(request: StoredFdcRequestRecord): StoredFdcProofRecord {
  const votingRoundId = request.votingRoundId ?? 7n;
  const proofCalldata = {
    merkleProof: [proofNode],
    data: {
      attestationType,
      sourceId,
      votingRound: votingRoundId.toString(),
      lowestUsedTimestamp: "1",
      requestBody: {
        minimalBlockNumber: "100",
        deadlineBlockNumber: "200",
        deadlineTimestamp: deadlineSeconds.toString(),
        destinationAddressHash: `0x${"04".repeat(32)}`,
        amount: "1000000",
        standardPaymentReference: paymentReference,
        checkSourceAddresses: false,
        sourceAddressesRoot: zeroBytes32,
      },
      responseBody: {
        minimalBlockTimestamp: "1",
        firstOverflowBlockNumber: "201",
        firstOverflowBlockTimestamp: (deadlineSeconds + 1n).toString(),
      },
    },
  };

  return {
    fdcProofId: `${request.fdcRequestId}:proof:${votingRoundId.toString()}`,
    fdcRequestId: request.fdcRequestId,
    redemptionRequestId: request.redemptionRequestId,
    assetManagerAddress: request.assetManagerAddress,
    requestHash: request.requestHash,
    responseBody: "0x5678",
    merkleProof: [proofNode],
    votingRoundId,
    proofJson: JSON.stringify({ proof: [proofNode] }),
    calldataJson: JSON.stringify(proofCalldata),
    proofReadyAt: "2026-07-08T00:00:01.000Z",
    createdAt: "2026-07-08T00:00:01.000Z",
  };
}

function xrpProofFixture(
  request: StoredFdcRequestRecord,
): StoredFdcProofRecord {
  const votingRoundId = request.votingRoundId ?? 7n;
  const proofCalldata = {
    merkleProof: [proofNode],
    data: {
      attestationType: xrpAttestationType,
      sourceId,
      votingRound: votingRoundId.toString(),
      lowestUsedTimestamp: "1",
      requestBody: {
        minimalBlockNumber: "100",
        deadlineBlockNumber: "200",
        deadlineTimestamp: deadlineSeconds.toString(),
        destinationAddressHash: `0x${"04".repeat(32)}`,
        amount: "990000",
        checkFirstMemoData: true,
        firstMemoDataHash: paymentReference,
        checkDestinationTag: true,
        destinationTag: "777",
        proofOwner: `0x${"00".repeat(20)}`,
      },
      responseBody: {
        minimalBlockTimestamp: "1",
        firstOverflowBlockNumber: "201",
        firstOverflowBlockTimestamp: (deadlineSeconds + 1n).toString(),
      },
    },
  };

  return {
    fdcProofId: `${request.fdcRequestId}:proof:${votingRoundId.toString()}`,
    fdcRequestId: request.fdcRequestId,
    redemptionRequestId: request.redemptionRequestId,
    assetManagerAddress: request.assetManagerAddress,
    requestHash: request.requestHash,
    responseBody: "0x9abc",
    merkleProof: [proofNode],
    votingRoundId,
    proofJson: JSON.stringify({ proof: [proofNode] }),
    calldataJson: JSON.stringify(proofCalldata),
    proofReadyAt: "2026-07-08T00:00:01.000Z",
    createdAt: "2026-07-08T00:00:01.000Z",
  };
}
