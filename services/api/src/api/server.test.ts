import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test, type TestContext } from "node:test";

import type {
  ApiErrorResponse,
  Bytes32,
  EvmAddress,
  GetAgentsResponse,
  GetHealthResponse,
  GetRedemptionResponse,
  HexString,
  TransactionHash,
} from "@harbor/shared";

import {
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from "../db/index.js";
import { buildFAssetIndexerCursorName } from "../indexer/index.js";
import {
  insertFdcProof,
  upsertAgent,
  upsertAgentReliabilityScore,
  upsertFdcRequest,
  upsertKeeperJob,
  upsertRedemption,
  upsertSyncCursor,
  upsertXrplObservation,
  type UpsertAgentReliabilityScoreInput,
  type UpsertFdcRequestInput,
  type UpsertRedemptionInput,
} from "../repositories/index.js";
import { resolveApiServerConfig, type ApiServerConfig } from "./config.js";
import { createApiServer } from "./server.js";
import { noopApiLogger } from "./logging.js";

const assetManagerAddress = `0x${"11".repeat(20)}` as EvmAddress;
const agentVaultA = `0x${"a1".repeat(20)}` as EvmAddress;
const agentVaultB = `0x${"b2".repeat(20)}` as EvmAddress;
const agentVaultC = `0x${"c3".repeat(20)}` as EvmAddress;
const redeemer = `0x${"33".repeat(20)}` as EvmAddress;
const xrplTransactionHash = `0x${"bb".repeat(32)}` as TransactionHash;
const defaultTransactionHash = `0x${"cc".repeat(32)}` as TransactionHash;
const paymentReference = `0x${"dd".repeat(32)}` as Bytes32;
const allowedOrigin = "http://localhost:3000";

function testConfig(): ApiServerConfig {
  const base = resolveApiServerConfig({});
  return {
    ...base,
    chainId: "114",
    assetManagerAddress,
    cors: {
      allowedOrigins: [allowedOrigin],
      allowedMethods: ["GET", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAgeSeconds: 600,
    },
    build: {
      service: "@harbor/api",
      version: "0.1.0-test",
      environment: "test",
      gitCommit: "abc123",
    },
  };
}

type TestServer = Readonly<{
  baseUrl: string;
  database: SqliteDatabase;
  server: Server;
}>;

function createTestDatabase(t: TestContext): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), "harbor-api-server-"));
  const database = openSqliteDatabase(join(directory, "harbor.sqlite"));
  runMigrations(database);

  t.after(() => {
    try {
      database.close();
    } catch {
      // The database may already be closed by a fault-injection test.
    }

    rmSync(directory, { recursive: true, force: true });
  });

  return database;
}

async function startTestServer(
  t: TestContext,
  database: SqliteDatabase,
  config: ApiServerConfig = testConfig(),
): Promise<TestServer> {
  const server = createApiServer({
    database,
    config,
    logger: noopApiLogger,
    generateRequestId: () => "test-request-id",
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        reject(new Error("failed to bind test server"));
        return;
      }

      resolve(address.port);
    });
  });

  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );

  return { baseUrl: `http://127.0.0.1:${port}`, database, server };
}

function reliabilityScore(
  overrides: Partial<UpsertAgentReliabilityScoreInput> &
    Pick<UpsertAgentReliabilityScoreInput, "agentVault">,
): UpsertAgentReliabilityScoreInput {
  return {
    score: 50,
    formulaVersion: "agent-reliability-mvp-v1",
    fulfillmentRate: 1,
    fulfillmentScore: 40,
    settlementTimeScore: 20,
    defaultPenalty: 0,
    availabilityScore: 20,
    collateralScore: 20,
    successfulRedemptions: 5,
    defaultedRedemptions: 0,
    totalTerminalRedemptions: 5,
    averageSettlementSeconds: 120,
    availability: "AVAILABLE",
    availableLots: 1000n,
    collateralRatioBips: 25000n,
    collateralRatioSource: "INVENTORY",
    ftsoStatus: "AVAILABLE",
    ftsoXrpUsdPrice: "0.5",
    ftsoFlrUsdPrice: "0.02",
    ftsoTimestamp: "2026-07-08T00:00:00.000Z",
    ftsoError: null,
    componentsJson: "{}",
    ...overrides,
  };
}

function seedAgentScore(
  database: SqliteDatabase,
  input: UpsertAgentReliabilityScoreInput,
): void {
  upsertAgent(database, { agentVault: input.agentVault });
  upsertAgentReliabilityScore(database, input);
}

function redemptionInput(
  overrides: Partial<UpsertRedemptionInput> &
    Pick<UpsertRedemptionInput, "requestId">,
): UpsertRedemptionInput {
  return {
    assetManagerAddress,
    sourceChainId: "114",
    redeemer,
    agentVault: agentVaultA,
    paymentAddress: "rDestinationAddress",
    valueUBA: 1_000_000n,
    feeUBA: 1_000n,
    paymentReference,
    firstUnderlyingBlock: 100n,
    lastUnderlyingBlock: 200n,
    lastUnderlyingTimestamp: 1_893_456_000n,
    executorFeeNatWei: 0n,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

function fdcRequestInput(
  overrides: Partial<UpsertFdcRequestInput> &
    Pick<UpsertFdcRequestInput, "fdcRequestId" | "redemptionRequestId">,
): UpsertFdcRequestInput {
  return {
    attestationType: `0x${"01".repeat(32)}` as Bytes32,
    sourceId: `0x${"02".repeat(32)}` as Bytes32,
    requestBody: `0x${"07".repeat(8)}` as HexString,
    requestHash: `0x${"ee".repeat(32)}` as Bytes32,
    status: "PROOF_READY",
    votingRoundId: 12_345n,
    ...overrides,
  };
}

async function getJson(
  baseUrl: string,
  path: string,
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`);
  const body: unknown = await response.json();
  return { status: response.status, headers: response.headers, body };
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  test("reports ok with database, cursor, keeper, FDC, and build info", async (t) => {
    const database = createTestDatabase(t);

    upsertSyncCursor(database, {
      cursorName: buildFAssetIndexerCursorName("114", assetManagerAddress),
      chainId: "114",
      blockNumber: "987654",
      logIndex: "4",
    });
    upsertKeeperJob(database, {
      jobId: "job-pending",
      jobType: "default-recovery",
      status: "PENDING",
      runAfter: "2026-07-08T00:00:00.000Z",
    });
    upsertKeeperJob(database, {
      jobId: "job-failed",
      jobType: "default-recovery",
      status: "FAILED",
      runAfter: "2026-07-08T00:00:00.000Z",
      lastError: "boom",
    });
    seedAgentScore(database, reliabilityScore({ agentVault: agentVaultA }));
    upsertRedemption(database, redemptionInput({ requestId: "1" }));
    upsertFdcRequest(
      database,
      fdcRequestInput({
        fdcRequestId: "fdc-req-health",
        redemptionRequestId: "1",
        status: "FINALIZED",
        votingRoundId: 42n,
      }),
    );
    insertFdcProof(database, {
      fdcProofId: "fdc-proof-health",
      fdcRequestId: "fdc-req-health",
      redemptionRequestId: "1",
      requestHash: `0x${"ee".repeat(32)}` as Bytes32,
      responseBody: "0x1234" as HexString,
      merkleProof: [`0x${"ab".repeat(32)}` as Bytes32],
      votingRoundId: 42n,
      proofReadyAt: "2026-07-08T02:00:00.000Z",
    });

    const { baseUrl } = await startTestServer(t, database);
    const { status, headers, body } = await getJson(baseUrl, "/health");
    const report = body as GetHealthResponse;

    assert.equal(status, 200);
    assert.equal(
      headers.get("content-type"),
      "application/json; charset=utf-8",
    );
    assert.equal(report.status, "ok");
    assert.equal(report.api.status, "ok");
    assert.equal(report.database.status, "ok");
    assert.equal(report.database.migrationsApplied, 6);
    assert.equal(
      report.database.latestMigrationId,
      "0006_agent_details_fields",
    );
    assert.equal(report.database.error, null);
    assert.equal(report.indexer.cursor?.blockNumber, "987654");
    assert.equal(report.indexer.cursor?.logIndex, "4");
    assert.equal(report.keeper.totalJobs, 2);
    assert.equal(report.keeper.pending, 1);
    assert.equal(report.keeper.failed, 1);
    assert.equal(report.keeper.ready, 1);
    assert.equal(report.keeper.lastError, "boom");
    assert.equal(report.fdc.lastRound?.votingRoundId, "42");
    assert.equal(report.fdc.lastRound?.source, "PROOF");
    assert.deepEqual(report.build, {
      service: "@harbor/api",
      version: "0.1.0-test",
      environment: "test",
      gitCommit: "abc123",
    });
  });

  test("reports empty component defaults on a freshly migrated database", async (t) => {
    const database = createTestDatabase(t);
    const { baseUrl } = await startTestServer(t, database);

    const { status, body } = await getJson(baseUrl, "/health");
    const report = body as GetHealthResponse;

    assert.equal(status, 200);
    assert.equal(report.status, "ok");
    assert.equal(report.indexer.cursor, null);
    assert.equal(report.keeper.totalJobs, 0);
    assert.equal(report.fdc.lastRound, null);
  });

  test("returns 503 and an error status when the database is unavailable", async (t) => {
    const database = createTestDatabase(t);
    const { baseUrl } = await startTestServer(t, database);

    // Simulate a database outage: subsequent queries throw.
    database.close();

    const { status, body } = await getJson(baseUrl, "/health");
    const report = body as GetHealthResponse;

    assert.equal(status, 503);
    assert.equal(report.status, "error");
    assert.equal(report.database.status, "error");
    assert.equal(report.database.migrationsApplied, null);
    assert.equal(typeof report.database.error, "string");
    assert.notEqual(report.database.error, null);
    assert.equal(report.api.status, "ok");
  });
});

// ---------------------------------------------------------------------------
// GET /agents
// ---------------------------------------------------------------------------

describe("GET /agents", () => {
  test("returns records ranked by score with JSON-safe amounts", async (t) => {
    const database = createTestDatabase(t);

    seedAgentScore(
      database,
      reliabilityScore({
        agentVault: agentVaultA,
        score: 40,
        availableLots: 111n,
        collateralRatioBips: 15000n,
      }),
    );
    seedAgentScore(
      database,
      reliabilityScore({
        agentVault: agentVaultB,
        score: 90,
        availableLots: 222n,
        collateralRatioBips: null,
        averageSettlementSeconds: null,
      }),
    );
    seedAgentScore(
      database,
      reliabilityScore({
        agentVault: agentVaultC,
        score: 65,
        availableLots: 333n,
        collateralRatioBips: 30000n,
        collateralRatioSource: "FTSO_DERIVED",
        ftsoStatus: "STALE",
      }),
    );

    const { baseUrl } = await startTestServer(t, database);
    const { status, body } = await getJson(baseUrl, "/agents?asset=FXRP");
    const response = body as GetAgentsResponse;

    assert.equal(status, 200);
    assert.equal(response.asset, "FXRP");
    assert.equal(response.scoreIsHeuristic, true);
    assert.equal(typeof response.generatedAt, "string");

    const order = response.agents.map((agent) => agent.agentVault);
    assert.deepEqual(order, [agentVaultB, agentVaultC, agentVaultA]);

    const [top, middle] = response.agents;
    assert.ok(top !== undefined && middle !== undefined);

    // Every record is flagged heuristic and numeric scores stay numbers.
    for (const agent of response.agents) {
      assert.equal(agent.scoreIsHeuristic, true);
      assert.equal(typeof agent.score, "number");
      assert.equal(typeof agent.fulfillmentScore, "number");
    }

    // bigint amounts are serialized as decimal strings.
    assert.equal(top.availableLots, "222");
    assert.equal(top.collateralRatioBips, null);
    assert.equal(top.averageSettlementSeconds, null);
    assert.equal(middle.availableLots, "333");
    assert.equal(middle.collateralRatioBips, "30000");

    // FTSO freshness is projected so clients can flag stale collateral fields.
    // The top agent's collateral is from inventory with fresh feeds; the middle
    // agent's ratio is FTSO-derived from a stale snapshot.
    assert.equal(top.ftsoStatus, "AVAILABLE");
    assert.equal(middle.collateralRatioSource, "FTSO_DERIVED");
    assert.equal(middle.ftsoStatus, "STALE");
  });

  test("defaults to FXRP when no asset query is provided", async (t) => {
    const database = createTestDatabase(t);
    seedAgentScore(database, reliabilityScore({ agentVault: agentVaultA }));

    const { baseUrl } = await startTestServer(t, database);
    const { status, body } = await getJson(baseUrl, "/agents");
    const response = body as GetAgentsResponse;

    assert.equal(status, 200);
    assert.equal(response.asset, "FXRP");
    assert.equal(response.agents.length, 1);
  });

  test("returns an empty ranked list when no scores exist", async (t) => {
    const database = createTestDatabase(t);
    const { baseUrl } = await startTestServer(t, database);

    const { status, body } = await getJson(baseUrl, "/agents");
    const response = body as GetAgentsResponse;

    assert.equal(status, 200);
    assert.deepEqual(response.agents, []);
  });

  test("rejects an unsupported asset with a 400 error", async (t) => {
    const database = createTestDatabase(t);
    const { baseUrl } = await startTestServer(t, database);

    const { status, body } = await getJson(baseUrl, "/agents?asset=BTC");
    const response = body as ApiErrorResponse;

    assert.equal(status, 400);
    assert.equal(response.error.code, "BAD_REQUEST");
    assert.deepEqual(response.error.details, {
      asset: "BTC",
      supportedAssets: ["FXRP"],
    });
  });
});

// ---------------------------------------------------------------------------
// GET /redemptions/:id
// ---------------------------------------------------------------------------

describe("GET /redemptions/:id", () => {
  test("returns 404 for an unknown id", async (t) => {
    const database = createTestDatabase(t);
    const { baseUrl } = await startTestServer(t, database);

    const { status, body } = await getJson(baseUrl, "/redemptions/999999");
    const response = body as ApiErrorResponse;

    assert.equal(status, 404);
    assert.equal(response.error.code, "NOT_FOUND");
    assert.equal(response.error.requestId, "test-request-id");
  });

  test("returns a requested/watching redemption timeline", async (t) => {
    const database = createTestDatabase(t);
    upsertRedemption(
      database,
      redemptionInput({
        requestId: "10",
        status: "WATCHING",
        updatedAt: "2026-07-08T00:30:00.000Z",
      }),
    );

    const { baseUrl } = await startTestServer(t, database);
    const { status, body } = await getJson(baseUrl, "/redemptions/10");
    const response = body as GetRedemptionResponse;

    assert.equal(status, 200);
    assert.equal(response.redemption.status, "WATCHING");
    assert.equal(response.redemption.valueUBA, "1000000");
    assert.deepEqual(
      response.statusTimeline.map((entry) => entry.status),
      ["REQUESTED", "WATCHING"],
    );
    assert.deepEqual(response.xrplReceipts, []);
    assert.equal(response.defaultTransactionHash, null);
  });

  test("returns a settled redemption with its XRPL receipt", async (t) => {
    const database = createTestDatabase(t);
    upsertRedemption(
      database,
      redemptionInput({
        requestId: "11",
        status: "SETTLED",
        transactionHash: xrplTransactionHash,
        updatedAt: "2026-07-08T02:00:00.000Z",
      }),
    );
    upsertXrplObservation(database, {
      observationId: "obs-11",
      redemptionRequestId: "11",
      transactionHash: xrplTransactionHash,
      sourceAddress: "rSource",
      destinationAddress: "rDestinationAddress",
      deliveredAmountUBA: 999_000n,
      feeDrops: 12n,
      paymentReference,
      ledgerIndex: 4_242n,
      closeTimestamp: "2026-07-08T01:00:00.000Z",
      validatedAt: "2026-07-08T01:00:00.000Z",
    });

    const { baseUrl } = await startTestServer(t, database);
    const { status, body } = await getJson(baseUrl, "/redemptions/11");
    const response = body as GetRedemptionResponse;

    assert.equal(status, 200);
    assert.equal(response.redemption.status, "SETTLED");
    assert.equal(response.xrplReceipts.length, 1);

    const [receipt] = response.xrplReceipts;
    assert.ok(receipt !== undefined);
    assert.equal(receipt.deliveredAmountUBA, "999000");
    assert.equal(receipt.ledgerIndex, "4242");
    assert.ok(
      response.statusTimeline.some((entry) => entry.status === "SETTLED"),
    );
  });

  test("returns a redemption with default recovery in progress", async (t) => {
    const database = createTestDatabase(t);
    upsertRedemption(
      database,
      redemptionInput({
        requestId: "12",
        status: "PROOF_READY",
        updatedAt: "2026-07-08T03:00:00.000Z",
      }),
    );
    upsertFdcRequest(
      database,
      fdcRequestInput({
        fdcRequestId: "fdc-req-12",
        redemptionRequestId: "12",
        status: "PROOF_READY",
        createdAt: "2026-07-08T01:00:00.000Z",
        updatedAt: "2026-07-08T01:30:00.000Z",
      }),
    );
    insertFdcProof(database, {
      fdcProofId: "fdc-proof-12",
      fdcRequestId: "fdc-req-12",
      redemptionRequestId: "12",
      requestHash: `0x${"ee".repeat(32)}` as Bytes32,
      responseBody: "0x1234" as HexString,
      merkleProof: [`0x${"ab".repeat(32)}` as Bytes32],
      votingRoundId: 12_345n,
      proofReadyAt: "2026-07-08T02:00:00.000Z",
    });

    const { baseUrl } = await startTestServer(t, database);
    const { status, body } = await getJson(baseUrl, "/redemptions/12");
    const response = body as GetRedemptionResponse;

    assert.equal(status, 200);
    assert.equal(response.redemption.status, "PROOF_READY");
    assert.equal(response.fdcRequests.length, 1);
    assert.equal(response.fdcRequests[0]?.status, "PROOF_READY");
    assert.equal(response.fdcProofs.length, 1);
    assert.equal(response.fdcProofs[0]?.votingRoundId, "12345");
    assert.equal(response.defaultTransactionHash, null);

    const statuses = response.statusTimeline.map((entry) => entry.status);
    assert.ok(statuses.includes("REQUEST_PROOF"));
    assert.ok(statuses.includes("PROOF_READY"));
  });

  test("returns a recovered redemption with its default transaction hash", async (t) => {
    const database = createTestDatabase(t);
    upsertRedemption(
      database,
      redemptionInput({
        requestId: "13",
        status: "RECOVERED",
        defaultTransactionHash,
        statusReason: "default executed",
        updatedAt: "2026-07-08T04:00:00.000Z",
      }),
    );

    const { baseUrl } = await startTestServer(t, database);
    const { status, body } = await getJson(baseUrl, "/redemptions/13");
    const response = body as GetRedemptionResponse;

    assert.equal(status, 200);
    assert.equal(response.redemption.status, "RECOVERED");
    assert.equal(
      response.redemption.defaultTransactionHash,
      defaultTransactionHash,
    );
    assert.equal(response.defaultTransactionHash, defaultTransactionHash);

    const statuses = response.statusTimeline.map((entry) => entry.status);
    assert.ok(statuses.includes("DEFAULT_SUBMITTED"));
    assert.equal(statuses.at(-1), "RECOVERED");
  });
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

describe("CORS", () => {
  test("answers preflight OPTIONS for an allowed origin", async (t) => {
    const database = createTestDatabase(t);
    const { baseUrl } = await startTestServer(t, database);

    const response = await fetch(`${baseUrl}/agents`, {
      method: "OPTIONS",
      headers: {
        origin: allowedOrigin,
        "access-control-request-method": "GET",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      allowedOrigin,
    );
    assert.equal(
      response.headers.get("access-control-allow-methods"),
      "GET, OPTIONS",
    );
    assert.equal(response.headers.get("vary"), "Origin");
  });

  test("echoes an allowed origin on a normal GET", async (t) => {
    const database = createTestDatabase(t);
    const { baseUrl } = await startTestServer(t, database);

    const response = await fetch(`${baseUrl}/health`, {
      headers: { origin: allowedOrigin },
    });
    await response.json();

    assert.equal(
      response.headers.get("access-control-allow-origin"),
      allowedOrigin,
    );
  });

  test("omits the CORS origin header for a disallowed origin", async (t) => {
    const database = createTestDatabase(t);
    const { baseUrl } = await startTestServer(t, database);

    const response = await fetch(`${baseUrl}/health`, {
      headers: { origin: "http://evil.example.com" },
    });
    await response.json();

    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});

// ---------------------------------------------------------------------------
// Error responses
// ---------------------------------------------------------------------------

describe("error responses", () => {
  test("returns a consistent 404 body for an unknown route", async (t) => {
    const database = createTestDatabase(t);
    const { baseUrl } = await startTestServer(t, database);

    const { status, headers, body } = await getJson(baseUrl, "/does-not-exist");
    const response = body as ApiErrorResponse;

    assert.equal(status, 404);
    assert.equal(headers.get("x-request-id"), "test-request-id");
    assert.equal(response.error.code, "NOT_FOUND");
    assert.equal(typeof response.error.message, "string");
    assert.equal(response.error.requestId, "test-request-id");
    assert.equal(response.error.details, null);
  });

  test("returns 405 for an unsupported method", async (t) => {
    const database = createTestDatabase(t);
    const { baseUrl } = await startTestServer(t, database);

    const response = await fetch(`${baseUrl}/agents`, { method: "POST" });
    const body = (await response.json()) as ApiErrorResponse;

    assert.equal(response.status, 405);
    assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
  });
});
