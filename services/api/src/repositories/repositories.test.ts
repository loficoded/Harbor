import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test, type TestContext } from "node:test";

import type { Bytes32, EvmAddress, TransactionHash } from "@harbor/shared";

import {
  listAppliedMigrations,
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from "../db/index.js";
import {
  getFdcProofByRequestAndRound,
  insertFdcProof,
  insertRedemptionEvent,
  listAgents,
  listFdcRequestsForRedemption,
  listReadyKeeperJobs,
  listRedemptionsByStatuses,
  listXrplObservationsForRedemption,
  upsertAgent,
  upsertFdcRequest,
  upsertKeeperJob,
  upsertRedemption,
  upsertSyncCursor,
  upsertXrplObservation,
  updateFdcRequestStatus,
  updateKeeperJobStatus,
  updateRedemptionStatus,
} from "./index.js";

const assetManagerAddress = `0x${"11".repeat(20)}` as EvmAddress;
const agentVault = `0x${"22".repeat(20)}` as EvmAddress;
const redeemer = `0x${"33".repeat(20)}` as EvmAddress;
const executor = `0x${"44".repeat(20)}` as EvmAddress;
const contractAddress = `0x${"55".repeat(20)}` as EvmAddress;
const sourceTransactionHash = `0x${"aa".repeat(32)}` as TransactionHash;
const xrplTransactionHash = `0x${"bb".repeat(32)}` as TransactionHash;
const defaultTransactionHash = `0x${"cc".repeat(32)}` as TransactionHash;
const paymentReference = `0x${"dd".repeat(32)}` as Bytes32;
const requestHash = `0x${"ee".repeat(32)}` as Bytes32;
const attestationType = `0x${"01".repeat(32)}` as Bytes32;
const sourceId = `0x${"02".repeat(32)}` as Bytes32;

function createTestDatabase(t: TestContext): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), "harbor-api-db-"));
  const databasePath = join(directory, "harbor.sqlite");
  const database = openSqliteDatabase(databasePath);
  runMigrations(database);

  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  return database;
}

function countRows(database: SqliteDatabase, tableName: string): number {
  const row = database
    .prepare<[], { count: number }>(
      `SELECT COUNT(*) AS count FROM ${tableName}`,
    )
    .get();

  return row?.count ?? 0;
}

function insertRedemptionFixture(database: SqliteDatabase) {
  return upsertRedemption(database, {
    assetManagerAddress,
    requestId: "42",
    sourceChainId: "114",
    sourceBlockNumber: "90071992547409931234",
    sourceLogIndex: "7",
    sourceTransactionHash,
    redeemer,
    agentVault,
    paymentAddress: "rDestinationAddress",
    valueUBA: 123456789012345678901234567890n,
    feeUBA: 98765432109876543210987654321n,
    paymentReference,
    firstUnderlyingBlock: 100000000000000000001n,
    lastUnderlyingBlock: 100000000000000000099n,
    lastUnderlyingTimestamp: 1893456000n,
    executor,
    executorFeeNatWei: 55555555555555555555n,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  });
}

describe("SQLite migrations", () => {
  test("migrates an empty database", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "harbor-api-empty-db-"));
    const databasePath = join(directory, "harbor.sqlite");
    const database = openSqliteDatabase(databasePath);

    t.after(() => {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    });

    const results = runMigrations(database);
    assert.deepEqual(results, [
      { id: "0001_initial_schema", applied: true },
      { id: "0002_agent_inventory_fields", applied: true },
      { id: "0003_agent_reliability_scores", applied: true },
      { id: "0004_xrpl_observation_receipts", applied: true },
      { id: "0005_fdc_request_proof_ready_status", applied: true },
    ]);

    const tableNames = database
      .prepare<[], { name: string }>(
        `
SELECT name
FROM sqlite_master
WHERE type = 'table'
ORDER BY name
`,
      )
      .all()
      .map((row) => row.name);

    assert.deepEqual(tableNames, [
      "agent_reliability_scores",
      "agents",
      "fdc_proofs",
      "fdc_requests",
      "keeper_jobs",
      "redemption_events",
      "redemptions",
      "schema_migrations",
      "sync_cursors",
      "xrpl_observations",
    ]);
    assert.deepEqual(listAppliedMigrations(database), [
      {
        id: "0001_initial_schema",
        appliedAt: listAppliedMigrations(database)[0]?.appliedAt,
      },
      {
        id: "0002_agent_inventory_fields",
        appliedAt: listAppliedMigrations(database)[1]?.appliedAt,
      },
      {
        id: "0003_agent_reliability_scores",
        appliedAt: listAppliedMigrations(database)[2]?.appliedAt,
      },
      {
        id: "0004_xrpl_observation_receipts",
        appliedAt: listAppliedMigrations(database)[3]?.appliedAt,
      },
      {
        id: "0005_fdc_request_proof_ready_status",
        appliedAt: listAppliedMigrations(database)[4]?.appliedAt,
      },
    ]);
    assert.deepEqual(runMigrations(database), [
      { id: "0001_initial_schema", applied: false },
      { id: "0002_agent_inventory_fields", applied: false },
      { id: "0003_agent_reliability_scores", applied: false },
      { id: "0004_xrpl_observation_receipts", applied: false },
      { id: "0005_fdc_request_proof_ready_status", applied: false },
    ]);
  });
});

describe("redemption repositories", () => {
  test("upserts redemptions idempotently and round trips bigint text values", (t) => {
    const database = createTestDatabase(t);

    const first = insertRedemptionFixture(database);
    const second = insertRedemptionFixture(database);

    assert.equal(countRows(database, "redemptions"), 1);
    assert.equal(second.requestId, first.requestId);
    assert.equal(first.valueUBA, 123456789012345678901234567890n);
    assert.equal(first.feeUBA, 98765432109876543210987654321n);
    assert.equal(first.sourceBlockNumber, "90071992547409931234");

    const rawRow = database
      .prepare<[], { value_uba: string; first_underlying_block: string }>(
        `
SELECT value_uba, first_underlying_block
FROM redemptions
WHERE request_id = '42'
`,
      )
      .get();

    assert.deepEqual(rawRow, {
      value_uba: "123456789012345678901234567890",
      first_underlying_block: "100000000000000000001",
    });
  });

  test("persists redemption status updates and event idempotency", (t) => {
    const database = createTestDatabase(t);
    insertRedemptionFixture(database);

    const settled = updateRedemptionStatus(database, {
      assetManagerAddress,
      requestId: "42",
      status: "SETTLED",
      transactionHash: xrplTransactionHash,
      defaultTransactionHash,
      statusReason: "xrpl-payment-observed",
      updatedAt: "2026-07-08T01:00:00.000Z",
    });

    assert.equal(settled.status, "SETTLED");
    assert.equal(settled.transactionHash, xrplTransactionHash);
    assert.equal(settled.defaultTransactionHash, defaultTransactionHash);
    assert.equal(settled.statusReason, "xrpl-payment-observed");

    const eventInput = {
      chainId: "114",
      contractAddress,
      blockNumber: "12345678901234567890",
      logIndex: "3",
      transactionHash: sourceTransactionHash,
      transactionIndex: "2",
      eventName: "RedemptionRequested",
      assetManagerAddress,
      requestId: "42",
      agentVault,
      redeemer,
      payload: { requestId: "42", valueUBA: "123" },
      observedAt: "2026-07-08T01:05:00.000Z",
    };

    const first = insertRedemptionEvent(database, eventInput);
    const second = insertRedemptionEvent(database, {
      ...eventInput,
      eventName: "RedemptionDefault",
      payload: { ignored: true },
    });

    assert.equal(countRows(database, "redemption_events"), 1);
    assert.equal(second.eventName, first.eventName);
    assert.deepEqual(first.payload, { requestId: "42", valueUBA: "123" });
    assert.deepEqual(
      listRedemptionsByStatuses(database, ["SETTLED"]).map(
        (redemption) => redemption.requestId,
      ),
      ["42"],
    );
  });
});

describe("XRPL and FDC repositories", () => {
  test("upserts XRPL observations by transaction hash and redemption request id", (t) => {
    const database = createTestDatabase(t);

    const first = upsertXrplObservation(database, {
      observationId: "observation-1",
      redemptionRequestId: "42",
      assetManagerAddress,
      transactionHash: xrplTransactionHash,
      sourceAddress: "rSourceAddress",
      destinationAddress: "rDestinationAddress",
      deliveredAmountUBA: 12345678901234567890n,
      feeDrops: 12n,
      paymentReference,
      ledgerIndex: 9876543210123456789n,
      closeTimestamp: "2026-07-08T02:00:00.000Z",
      validatedAt: "2026-07-08T02:00:00.000Z",
      rawJson: '{"validated":true}',
      createdAt: "2026-07-08T02:00:01.000Z",
    });
    const second = upsertXrplObservation(database, {
      observationId: "observation-2",
      redemptionRequestId: "42",
      assetManagerAddress,
      transactionHash: xrplTransactionHash,
      sourceAddress: "rSourceAddress",
      destinationAddress: "rDestinationAddress",
      deliveredAmountUBA: 12345678901234567890n,
      feeDrops: 12n,
      paymentReference,
      ledgerIndex: 9876543210123456789n,
      validatedAt: "2026-07-08T02:00:00.000Z",
      createdAt: "2026-07-08T02:00:01.000Z",
    });

    assert.equal(countRows(database, "xrpl_observations"), 1);
    assert.equal(first.observationId, "observation-1");
    assert.equal(second.observationId, "observation-1");
    assert.equal(second.closeTimestamp, "2026-07-08T02:00:00.000Z");
    assert.equal(second.deliveredAmountUBA, 12345678901234567890n);
    assert.deepEqual(
      listXrplObservationsForRedemption(database, "42").map(
        (observation) => observation.transactionHash,
      ),
      [xrplTransactionHash],
    );
  });

  test("upserts FDC requests and proofs idempotently", (t) => {
    const database = createTestDatabase(t);

    const firstRequest = upsertFdcRequest(database, {
      fdcRequestId: "fdc-request-1",
      redemptionRequestId: "42",
      assetManagerAddress,
      attestationType,
      sourceId,
      sourceChainId: "XRPL",
      requestBody: "0x1234",
      requestHash,
      createdAt: "2026-07-08T03:00:00.000Z",
      updatedAt: "2026-07-08T03:00:00.000Z",
    });
    const duplicateByHash = upsertFdcRequest(database, {
      fdcRequestId: "fdc-request-duplicate",
      redemptionRequestId: "42",
      assetManagerAddress,
      attestationType,
      sourceId,
      requestBody: "0x5678",
      requestHash,
      status: "SUBMITTED",
      votingRoundId: 98765432109876543210n,
      updatedAt: "2026-07-08T03:01:00.000Z",
    });
    const duplicateByBody = upsertFdcRequest(database, {
      fdcRequestId: "fdc-request-duplicate-body",
      redemptionRequestId: "42",
      assetManagerAddress,
      attestationType,
      sourceId,
      requestBody: "0x1234",
      requestHash: `0x${"ef".repeat(32)}` as Bytes32,
      status: "FINALIZED",
      updatedAt: "2026-07-08T03:02:00.000Z",
    });

    assert.equal(countRows(database, "fdc_requests"), 1);
    assert.equal(firstRequest.fdcRequestId, "fdc-request-1");
    assert.equal(duplicateByHash.fdcRequestId, "fdc-request-1");
    assert.equal(duplicateByBody.status, "FINALIZED");
    assert.equal(duplicateByHash.votingRoundId, 98765432109876543210n);

    const failed = updateFdcRequestStatus(database, {
      fdcRequestId: "fdc-request-1",
      status: "FAILED",
      lastError: "rate limited",
      retryCount: 2,
      nextRetryAt: "2026-07-08T03:10:00.000Z",
      updatedAt: "2026-07-08T03:03:00.000Z",
    });

    assert.equal(failed.status, "FAILED");
    assert.equal(failed.lastError, "rate limited");
    assert.equal(failed.retryCount, 2);

    const proofReady = updateFdcRequestStatus(database, {
      fdcRequestId: "fdc-request-1",
      status: "PROOF_READY",
      lastError: null,
      retryCount: 0,
      nextRetryAt: null,
      updatedAt: "2026-07-08T03:19:00.000Z",
    });

    assert.equal(proofReady.status, "PROOF_READY");
    assert.equal(proofReady.lastError, null);
    assert.equal(proofReady.retryCount, 0);
    assert.equal(proofReady.nextRetryAt, null);

    const firstProof = insertFdcProof(database, {
      fdcProofId: "fdc-proof-1",
      fdcRequestId: "fdc-request-1",
      redemptionRequestId: "42",
      assetManagerAddress,
      requestHash,
      responseBody: "0xabcd",
      merkleProof: [paymentReference],
      votingRoundId: 98765432109876543210n,
      proofJson: '{"proof":true}',
      calldataJson: '{"args":[]}',
      proofReadyAt: "2026-07-08T03:20:00.000Z",
      createdAt: "2026-07-08T03:20:01.000Z",
    });
    const duplicateProof = insertFdcProof(database, {
      fdcProofId: "fdc-proof-duplicate",
      fdcRequestId: "fdc-request-1",
      redemptionRequestId: "42",
      assetManagerAddress,
      requestHash,
      responseBody: "0xffff",
      merkleProof: [],
      votingRoundId: 98765432109876543210n,
    });

    assert.equal(countRows(database, "fdc_proofs"), 1);
    assert.equal(duplicateProof.fdcProofId, firstProof.fdcProofId);
    assert.deepEqual(firstProof.merkleProof, [paymentReference]);
    assert.equal(
      getFdcProofByRequestAndRound(
        database,
        "fdc-request-1",
        98765432109876543210n,
      )?.responseBody,
      "0xabcd",
    );
    assert.deepEqual(
      listFdcRequestsForRedemption(database, "42").map(
        (request) => request.fdcRequestId,
      ),
      ["fdc-request-1"],
    );
  });
});

describe("agent, keeper, and cursor repositories", () => {
  test("persists agents, keeper jobs, and sync cursors", (t) => {
    const database = createTestDatabase(t);

    const agent = upsertAgent(database, {
      agentVault,
      owner: redeemer,
      paymentAddress: "rAgentAddress",
      availability: "AVAILABLE",
      redemptionFeeBips: 25,
      availableLots: 12345678901234567890n,
      score: {
        agentVault,
        score: 91.5,
        successfulRedemptions: 10,
        failedRedemptions: 1,
        averagePaymentSeconds: 42,
        updatedAt: "2026-07-08T04:00:00.000Z",
      },
      rawInventoryJson: '{"lots":"123"}',
      lastInventoryRefreshAt: "2026-07-08T04:00:01.000Z",
      createdAt: "2026-07-08T04:00:02.000Z",
      updatedAt: "2026-07-08T04:00:03.000Z",
    });

    assert.equal(agent.availableLots, 12345678901234567890n);
    assert.equal(listAgents(database)[0]?.score.score, 91.5);

    const cursor = upsertSyncCursor(database, {
      cursorName: "asset-manager:114",
      chainId: "114",
      blockNumber: "12345678901234567890",
      logIndex: "8",
      payloadJson: '{"mode":"backfill"}',
      updatedAt: "2026-07-08T04:10:00.000Z",
    });

    assert.equal(cursor.blockNumber, "12345678901234567890");

    const job = upsertKeeperJob(database, {
      jobId: "keeper-job-1",
      jobType: "submit-default",
      assetManagerAddress,
      redemptionRequestId: "42",
      runAfter: "2026-07-08T05:00:00.000Z",
      payloadJson: '{"requestId":"42"}',
      createdAt: "2026-07-08T04:20:00.000Z",
      updatedAt: "2026-07-08T04:20:00.000Z",
    });

    assert.equal(job.status, "PENDING");
    assert.deepEqual(
      listReadyKeeperJobs(database, "2026-07-08T05:00:00.000Z", 10).map(
        (readyJob) => readyJob.jobId,
      ),
      ["keeper-job-1"],
    );

    const running = updateKeeperJobStatus(database, {
      jobId: "keeper-job-1",
      status: "RUNNING",
      attempts: 1,
      lockedAt: "2026-07-08T05:00:01.000Z",
      updatedAt: "2026-07-08T05:00:01.000Z",
    });

    assert.equal(running.status, "RUNNING");
    assert.equal(running.attempts, 1);
  });
});
