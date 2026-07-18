import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test, type TestContext } from "node:test";
import fc from "fast-check";

import type {
  Bytes32,
  EvmAddress,
  RedemptionKind,
  TransactionHash,
} from "@harbor/shared";

import {
  listAppliedMigrations,
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from "../db/index.js";
import {
  getFdcProofByRequestAndRound,
  getAgent,
  getRedemptionByRequestId,
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
      { id: "0006_agent_details_fields", applied: true },
      { id: "0007_redemption_tag_fields", applied: true },
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
      {
        id: "0006_agent_details_fields",
        appliedAt: listAppliedMigrations(database)[5]?.appliedAt,
      },
      {
        id: "0007_redemption_tag_fields",
        appliedAt: listAppliedMigrations(database)[6]?.appliedAt,
      },
    ]);
    assert.deepEqual(runMigrations(database), [
      { id: "0001_initial_schema", applied: false },
      { id: "0002_agent_inventory_fields", applied: false },
      { id: "0003_agent_reliability_scores", applied: false },
      { id: "0004_xrpl_observation_receipts", applied: false },
      { id: "0005_fdc_request_proof_ready_status", applied: false },
      { id: "0006_agent_details_fields", applied: false },
      { id: "0007_redemption_tag_fields", applied: false },
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

  test("never downgrades a WITH_TAG redemption to STANDARD on a later upsert (regression: item 3)", (t) => {
    const database = createTestDatabase(t);

    const base = {
      assetManagerAddress,
      requestId: "77",
      sourceChainId: "114",
      redeemer,
      agentVault,
      paymentAddress: "rDestinationAddress",
      valueUBA: 10_000_000n,
      feeUBA: 0n,
      paymentReference,
      firstUnderlyingBlock: 100n,
      lastUnderlyingBlock: 200n,
      lastUnderlyingTimestamp: 1893456000n,
      executor,
      executorFeeNatWei: 0n,
    };

    // Created as a tag-lane (WITH_TAG) redemption with tag 12345.
    const created = upsertRedemption(database, {
      ...base,
      redemptionKind: "WITH_TAG",
      destinationTag: 12345n,
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
    });
    assert.equal(created.redemptionKind, "WITH_TAG");
    assert.equal(created.destinationTag, 12345n);

    // A later status-carrying upsert omits redemptionKind (which defaults to
    // STANDARD) and destinationTag. Before the fix this downgraded the row and
    // would misroute the on-chain default to the standard lane.
    const updated = upsertRedemption(database, {
      ...base,
      status: "WATCHING",
      updatedAt: "2026-07-08T01:00:00.000Z",
    });
    assert.equal(updated.redemptionKind, "WITH_TAG");
    assert.equal(updated.destinationTag, 12345n);
  });

  test("keeps STANDARD when omitted and allows a STANDARD→WITH_TAG upgrade (regression: item 3)", (t) => {
    const database = createTestDatabase(t);

    const base = {
      assetManagerAddress,
      requestId: "78",
      sourceChainId: "114",
      redeemer,
      agentVault,
      paymentAddress: "rDestinationAddress",
      valueUBA: 10_000_000n,
      feeUBA: 0n,
      paymentReference,
      firstUnderlyingBlock: 100n,
      lastUnderlyingBlock: 200n,
      lastUnderlyingTimestamp: 1893456000n,
      executor,
      executorFeeNatWei: 0n,
    };

    // Standard row; a later upsert that omits the kind must stay STANDARD.
    upsertRedemption(database, { ...base });
    const stillStandard = upsertRedemption(database, {
      ...base,
      status: "WATCHING",
    });
    assert.equal(stillStandard.redemptionKind, "STANDARD");

    // An explicit WITH_TAG value upgrades the lane (the intrinsic kind is
    // corrected forward, never backward).
    const upgraded = upsertRedemption(database, {
      ...base,
      redemptionKind: "WITH_TAG",
      destinationTag: 0n,
    });
    assert.equal(upgraded.redemptionKind, "WITH_TAG");
    assert.equal(upgraded.destinationTag, 0n);
  });

  test("fails loudly when a persisted redemption_kind is corrupt (regression: item 4)", (t) => {
    const database = createTestDatabase(t);
    insertRedemptionFixture(database); // request_id "42", kind STANDARD

    // Corrupt the persisted lane directly (bad migration / manual edit).
    database
      .prepare(
        `UPDATE redemptions SET redemption_kind = 'BOGUS' WHERE request_id = '42'`,
      )
      .run();

    assert.throws(
      () => getRedemptionByRequestId(database, "42"),
      /Corrupt redemption_kind "BOGUS" for redemption request 42/,
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
  test("defaults agent details to all-null and round-trips fetched details", (t) => {
    const database = createTestDatabase(t);

    const created = upsertAgent(database, { agentVault });
    assert.deepEqual(created.details, {
      name: null,
      description: null,
      iconUrl: null,
      termsOfUseUrl: null,
    });

    const withDetails = upsertAgent(database, {
      agentVault,
      details: {
        name: "Acme Redeemer",
        description: "Reliable FXRP agent",
        iconUrl: "https://cdn.example.com/acme.png",
        termsOfUseUrl: "https://acme.example.com/terms",
      },
    });
    assert.deepEqual(withDetails.details, {
      name: "Acme Redeemer",
      description: "Reliable FXRP agent",
      iconUrl: "https://cdn.example.com/acme.png",
      termsOfUseUrl: "https://acme.example.com/terms",
    });
    assert.deepEqual(
      getAgent(database, agentVault)?.details,
      withDetails.details,
    );
  });

  test("preserves details when omitted and clears them when fetched empty", (t) => {
    const database = createTestDatabase(t);
    upsertAgent(database, {
      agentVault,
      details: {
        name: "Acme",
        description: null,
        iconUrl: "https://x.example.com/i.png",
        termsOfUseUrl: null,
      },
    });

    // An upsert that omits details (not fetched) preserves stored values,
    // matching the availability/score "fetched vs. not fetched" semantics.
    upsertAgent(database, { agentVault, availability: "AVAILABLE" });
    assert.equal(getAgent(database, agentVault)?.details.name, "Acme");
    assert.equal(
      getAgent(database, agentVault)?.details.iconUrl,
      "https://x.example.com/i.png",
    );

    // Passing all-null details (fetched, but the owner cleared them) clears.
    upsertAgent(database, {
      agentVault,
      details: {
        name: null,
        description: null,
        iconUrl: null,
        termsOfUseUrl: null,
      },
    });
    assert.deepEqual(getAgent(database, agentVault)?.details, {
      name: null,
      description: null,
      iconUrl: null,
      termsOfUseUrl: null,
    });
  });

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

function tagConsistencyBase(requestId: string) {
  return {
    assetManagerAddress,
    requestId,
    sourceChainId: "114",
    redeemer,
    agentVault,
    paymentAddress: "rDestinationAddress",
    valueUBA: 10_000_000n,
    feeUBA: 0n,
    paymentReference,
    firstUnderlyingBlock: 100n,
    lastUnderlyingBlock: 200n,
    lastUnderlyingTimestamp: 1893456000n,
    executor,
    executorFeeNatWei: 0n,
  };
}

describe("redemption tag/kind consistency (item 4)", () => {
  test("rejects a WITH_TAG redemption that is missing its destination tag", (t) => {
    const database = createTestDatabase(t);
    assert.throws(
      () =>
        upsertRedemption(database, {
          ...tagConsistencyBase("200"),
          redemptionKind: "WITH_TAG",
          destinationTag: null,
        }),
      /WITH_TAG redemption request 200 is missing its destination tag/,
    );
  });

  test("rejects a STANDARD redemption that carries a destination tag (with the tag in the message)", (t) => {
    const database = createTestDatabase(t);
    assert.throws(
      () =>
        upsertRedemption(database, {
          ...tagConsistencyBase("201"),
          redemptionKind: "STANDARD",
          destinationTag: 42n,
        }),
      /STANDARD redemption request 201 must not carry a destination tag \(found 42\)/,
    );
  });

  test("accepts WITH_TAG with tag 0 and STANDARD with a null tag", (t) => {
    const database = createTestDatabase(t);
    const withZero = upsertRedemption(database, {
      ...tagConsistencyBase("202"),
      redemptionKind: "WITH_TAG",
      destinationTag: 0n,
    });
    assert.equal(withZero.redemptionKind, "WITH_TAG");
    assert.equal(withZero.destinationTag, 0n);

    const standard = upsertRedemption(database, {
      ...tagConsistencyBase("203"),
      redemptionKind: "STANDARD",
      destinationTag: null,
    });
    assert.equal(standard.redemptionKind, "STANDARD");
    assert.equal(standard.destinationTag, null);
  });

  test("round-trips WITH_TAG tag=4242 and STANDARD tag=null through getRedemption", (t) => {
    const database = createTestDatabase(t);
    upsertRedemption(database, {
      ...tagConsistencyBase("204"),
      redemptionKind: "WITH_TAG",
      destinationTag: 4242n,
    });
    const tagged = getRedemptionByRequestId(database, "204");
    assert.equal(tagged?.redemptionKind, "WITH_TAG");
    assert.equal(tagged?.destinationTag, 4242n);

    upsertRedemption(database, {
      ...tagConsistencyBase("205"),
      redemptionKind: "STANDARD",
    });
    const standard = getRedemptionByRequestId(database, "205");
    assert.equal(standard?.redemptionKind, "STANDARD");
    assert.equal(standard?.destinationTag, null);
  });

  test("tag 0 round-trips as 0n and is preserved by a later tag-omitting upsert (never collapses to null)", (t) => {
    const database = createTestDatabase(t);
    upsertRedemption(database, {
      ...tagConsistencyBase("206"),
      redemptionKind: "WITH_TAG",
      destinationTag: 0n,
    });
    const stored = getRedemptionByRequestId(database, "206");
    assert.equal(stored?.destinationTag, 0n);
    assert.notEqual(stored?.destinationTag, null);

    // A later status-only upsert omits both kind and tag: the WITH_TAG lane and
    // the tag=0 must survive (COALESCE keeps "0", CASE keeps WITH_TAG).
    const updated = upsertRedemption(database, {
      ...tagConsistencyBase("206"),
      status: "WATCHING",
    });
    assert.equal(updated.redemptionKind, "WITH_TAG");
    assert.equal(updated.destinationTag, 0n);
  });

  test("corrupt DB: a WITH_TAG row with a NULL destination tag fails loudly on read", (t) => {
    const database = createTestDatabase(t);
    upsertRedemption(database, {
      ...tagConsistencyBase("300"),
      redemptionKind: "STANDARD",
    });
    // Simulate a bad migration / manual edit that violates the invariant.
    database
      .prepare(
        `UPDATE redemptions SET redemption_kind = 'WITH_TAG', destination_tag = NULL WHERE request_id = '300'`,
      )
      .run();
    assert.throws(
      () => getRedemptionByRequestId(database, "300"),
      /WITH_TAG redemption request 300 is missing its destination tag/,
    );
  });

  test("corrupt DB: a STANDARD row that carries a destination tag fails loudly on read", (t) => {
    const database = createTestDatabase(t);
    upsertRedemption(database, {
      ...tagConsistencyBase("301"),
      redemptionKind: "STANDARD",
    });
    database
      .prepare(
        `UPDATE redemptions SET destination_tag = '42' WHERE request_id = '301'`,
      )
      .run();
    assert.throws(
      () => getRedemptionByRequestId(database, "301"),
      /STANDARD redemption request 301 must not carry a destination tag \(found 42\)/,
    );
  });

  test("fuzz: only consistent kind/tag combinations persist; inconsistent ones throw", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<RedemptionKind>("STANDARD", "WITH_TAG"),
        fc.oneof(
          fc.constant<bigint | null>(null),
          fc.bigInt({ min: 0n, max: 0xffffffffn }),
        ),
        (kind, tag) => {
          const database = openSqliteDatabase(":memory:");
          runMigrations(database);
          const input = {
            ...tagConsistencyBase("1"),
            redemptionKind: kind,
            destinationTag: tag,
          };
          const consistent =
            (kind === "WITH_TAG" && tag !== null) ||
            (kind === "STANDARD" && tag === null);

          if (consistent) {
            const stored = upsertRedemption(database, input);
            assert.equal(stored.redemptionKind, kind);
            assert.equal(stored.destinationTag, tag);
          } else {
            assert.throws(() => upsertRedemption(database, input));
          }
          database.close();
        },
      ),
      { numRuns: 200 },
    );
  });
});
