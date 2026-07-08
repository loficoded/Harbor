import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";

import type { Bytes32, EvmAddress, TransactionHash } from "@harbor/shared";

import {
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from "../db/index.js";
import {
  getAgent,
  getAgentReliabilityScore,
  listAgentReliabilityScores,
  upsertAgent,
  upsertRedemption,
} from "../repositories/index.js";
import {
  calculateAgentReliabilityScore,
  flrUsdFtsoFeedId,
  readOptionalFtsoPriceSnapshot,
  refreshAgentReliabilityScores,
  unavailableFtsoPriceSnapshot,
  xrpUsdFtsoFeedId,
  type AgentReliabilityScoreInput,
  type FtsoFeedValue,
  type FtsoPriceSnapshot,
  type FtsoReadContractClient,
  type RedemptionHistorySummary,
} from "./agentReliability.js";

type ReadContractParameters = Parameters<
  FtsoReadContractClient["readContract"]
>[0];

const refreshedAt = "2026-07-08T00:00:00.000Z";
const assetManagerAddress = `0x${"11".repeat(20)}` as EvmAddress;
const ftsoV2Address = `0x${"12".repeat(20)}` as EvmAddress;
const agentVaultA = `0x${"aa".repeat(20)}` as EvmAddress;
const agentVaultB = `0x${"bb".repeat(20)}` as EvmAddress;
const agentVaultC = `0x${"cc".repeat(20)}` as EvmAddress;
const redeemer = `0x${"33".repeat(20)}` as EvmAddress;
const executor = `0x${"44".repeat(20)}` as EvmAddress;
const sourceTransactionHash = `0x${"aa".repeat(32)}` as TransactionHash;
const settlementTransactionHash = `0x${"bb".repeat(32)}` as TransactionHash;
const defaultTransactionHash = `0x${"cc".repeat(32)}` as TransactionHash;
const paymentReference = `0x${"dd".repeat(32)}` as Bytes32;

function createTestDatabase(t: TestContext): SqliteDatabase {
  const database = openSqliteDatabase(":memory:");
  runMigrations(database);

  t.after(() => {
    database.close();
  });

  return database;
}

function createMockFtsoClient(
  handler: (parameters: ReadContractParameters) => unknown | Promise<unknown>,
): { client: FtsoReadContractClient; calls: ReadContractParameters[] } {
  const calls: ReadContractParameters[] = [];

  return {
    calls,
    client: {
      async readContract(parameters) {
        calls.push(parameters);
        return handler(parameters);
      },
    },
  };
}

function ftsoTimestamp(offsetSeconds = 0): bigint {
  return BigInt(Math.floor(Date.parse(refreshedAt) / 1000) + offsetSeconds);
}

function successfulFtsoClient() {
  return createMockFtsoClient(({ functionName }) => {
    if (functionName === "calculateFeeByIds") {
      return 123n;
    }

    if (functionName === "getFeedsById") {
      return [[50_000_000n, 1_000_000n], [8, 8], ftsoTimestamp()];
    }

    throw new Error(`unexpected FTSO function ${functionName}`);
  });
}

function feedValue(
  name: "XRP/USD" | "FLR/USD",
  value: bigint,
  decimals: number,
): FtsoFeedValue {
  return {
    feedId: name === "XRP/USD" ? xrpUsdFtsoFeedId : flrUsdFtsoFeedId,
    name,
    value,
    decimals,
    timestamp: ftsoTimestamp(-7_200),
    price: name === "XRP/USD" ? "0.5" : "0.01",
  };
}

function staleFtsoSnapshot(): FtsoPriceSnapshot {
  return {
    status: "STALE",
    xrpUsd: feedValue("XRP/USD", 50_000_000n, 8),
    flrUsd: feedValue("FLR/USD", 1_000_000n, 8),
    timestamp: ftsoTimestamp(-7_200),
    readAt: refreshedAt,
    error: null,
  };
}

function scoreInput(
  overrides: {
    history?: Partial<RedemptionHistorySummary>;
    availability?: AgentReliabilityScoreInput["availability"];
    availableLots?: bigint;
    collateralRatioBips?: bigint | null;
    collateralRatioSource?: AgentReliabilityScoreInput["collateralRatioSource"];
    priceDerivedCollateralRatioBips?: bigint | null;
    ftsoSnapshot?: FtsoPriceSnapshot;
  } = {},
): AgentReliabilityScoreInput {
  const history = {
    successfulRedemptions: 0,
    defaultedRedemptions: 0,
    averageSettlementSeconds: null,
    ...overrides.history,
  };

  return {
    agentVault: agentVaultA,
    history,
    availability: overrides.availability ?? "AVAILABLE",
    availableLots: overrides.availableLots ?? 10n,
    collateralRatioBips: overrides.collateralRatioBips ?? null,
    collateralRatioSource:
      overrides.collateralRatioSource ??
      (overrides.collateralRatioBips === undefined
        ? "UNAVAILABLE"
        : "INVENTORY"),
    priceDerivedCollateralRatioBips:
      overrides.priceDerivedCollateralRatioBips ?? null,
    ftsoSnapshot:
      overrides.ftsoSnapshot ?? unavailableFtsoPriceSnapshot(refreshedAt),
    refreshedAt,
  };
}

function insertRedemptionFixture(
  database: SqliteDatabase,
  input: Readonly<{
    requestId: string;
    agentVault: EvmAddress;
    status: "SETTLED" | "RECOVERED";
    createdAt: string;
    updatedAt: string;
  }>,
): void {
  upsertRedemption(database, {
    assetManagerAddress,
    requestId: input.requestId,
    sourceChainId: "114",
    sourceTransactionHash,
    transactionHash:
      input.status === "SETTLED" ? settlementTransactionHash : null,
    redeemer,
    agentVault: input.agentVault,
    paymentAddress: "rDestinationAddress",
    valueUBA: 1_000_000n,
    feeUBA: 1_000n,
    paymentReference,
    firstUnderlyingBlock: 100n,
    lastUnderlyingBlock: 200n,
    lastUnderlyingTimestamp: 1_783_468_800n,
    executor,
    executorFeeNatWei: 10n,
    status: input.status,
    defaultTransactionHash:
      input.status === "RECOVERED" ? defaultTransactionHash : null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}

describe("Agent reliability score formula", () => {
  test("scores an available agent with no redemption history from neutral history components", () => {
    const score = calculateAgentReliabilityScore(scoreInput());

    assert.equal(score.score, 55);
    assert.equal(score.fulfillmentRate, null);
    assert.equal(score.fulfillmentScore, 22.5);
    assert.equal(score.settlementTimeScore, 7.5);
    assert.equal(score.availabilityScore, 20);
    assert.equal(score.collateralScore, 5);
    assert.equal(score.ftsoStatus, "UNAVAILABLE");
  });

  test("caps perfect fulfillment with fast settlement and strong collateral at 100", () => {
    const score = calculateAgentReliabilityScore(
      scoreInput({
        history: {
          successfulRedemptions: 4,
          defaultedRedemptions: 0,
          averageSettlementSeconds: 1_800,
        },
        collateralRatioBips: 20_000n,
      }),
    );

    assert.equal(score.score, 100);
    assert.equal(score.fulfillmentRate, 1);
    assert.equal(score.defaultPenalty, 0);
  });

  test("penalizes mixed fulfillment and defaults explainably", () => {
    const score = calculateAgentReliabilityScore(
      scoreInput({
        history: {
          successfulRedemptions: 3,
          defaultedRedemptions: 2,
          averageSettlementSeconds: 43_200,
        },
        collateralRatioBips: 16_000n,
      }),
    );

    assert.equal(score.score, 54.83);
    assert.equal(score.fulfillmentRate, 0.6);
    assert.equal(score.fulfillmentScore, 27);
    assert.equal(score.defaultPenalty, 10);
    assert.equal(score.collateralScore, 10);
  });

  test("keeps stale or missing FTSO values as metadata without blocking scoring", () => {
    const score = calculateAgentReliabilityScore(
      scoreInput({
        ftsoSnapshot: staleFtsoSnapshot(),
        collateralRatioBips: null,
        collateralRatioSource: "UNAVAILABLE",
      }),
    );
    const components = JSON.parse(score.componentsJson) as {
      ftso?: { status?: string };
    };

    assert.equal(score.ftsoStatus, "STALE");
    assert.equal(score.ftsoXrpUsdPrice, "0.5");
    assert.equal(score.collateralScore, 5);
    assert.equal(components.ftso?.status, "STALE");
  });

  test("removes availability points for unavailable agents", () => {
    const score = calculateAgentReliabilityScore(
      scoreInput({
        history: {
          successfulRedemptions: 4,
          defaultedRedemptions: 0,
          averageSettlementSeconds: 1_800,
        },
        availability: "UNAVAILABLE",
        availableLots: 99n,
        collateralRatioBips: 20_000n,
      }),
    );

    assert.equal(score.availabilityScore, 0);
    assert.equal(score.score, 80);
  });

  test("handles extreme but valid bigint inventory values within score bounds", () => {
    const score = calculateAgentReliabilityScore(
      scoreInput({
        availableLots: 2n ** 255n,
        collateralRatioBips: 2n ** 200n,
      }),
    );

    assert.equal(score.collateralScore, 20);
    assert.ok(score.score >= 0);
    assert.ok(score.score <= 100);
  });

  test("score bounds stay between 0 and 100 across representative cases", () => {
    const cases = [
      scoreInput({ availability: "UNAVAILABLE", availableLots: 0n }),
      scoreInput({
        history: {
          successfulRedemptions: 0,
          defaultedRedemptions: 100,
          averageSettlementSeconds: null,
        },
        availability: "UNAVAILABLE",
        availableLots: 0n,
        collateralRatioBips: 0n,
      }),
      scoreInput({
        history: {
          successfulRedemptions: 100,
          defaultedRedemptions: 0,
          averageSettlementSeconds: 1,
        },
        collateralRatioBips: 1_000_000n,
      }),
    ];

    for (const input of cases) {
      const score = calculateAgentReliabilityScore(input);
      assert.ok(score.score >= 0);
      assert.ok(score.score <= 100);
    }
  });
});

describe("FTSO price reader", () => {
  test("reads XRP/USD and FLR/USD feeds with the calculated fee", async () => {
    const { client, calls } = successfulFtsoClient();
    const snapshot = await readOptionalFtsoPriceSnapshot({
      ftsoClient: client,
      ftsoV2Address,
      readAt: refreshedAt,
      maxAgeSeconds: 60,
    });

    assert.equal(snapshot.status, "AVAILABLE");
    assert.equal(snapshot.xrpUsd?.price, "0.5");
    assert.equal(snapshot.flrUsd?.price, "0.01");
    assert.equal(calls[0]?.functionName, "calculateFeeByIds");
    assert.equal(calls[1]?.functionName, "getFeedsById");
    assert.equal(calls[1]?.value, 123n);
    assert.deepEqual(calls[1]?.args, [[xrpUsdFtsoFeedId, flrUsdFtsoFeedId]]);
  });

  test("marks old successful FTSO reads as stale", async () => {
    const { client } = createMockFtsoClient(({ functionName }) => {
      if (functionName === "calculateFeeByIds") {
        return 0n;
      }

      return [[50_000_000n, 1_000_000n], [8, 8], ftsoTimestamp(-120)];
    });
    const snapshot = await readOptionalFtsoPriceSnapshot({
      ftsoClient: client,
      ftsoV2Address,
      readAt: refreshedAt,
      maxAgeSeconds: 60,
    });

    assert.equal(snapshot.status, "STALE");
    assert.equal(snapshot.error, null);
  });

  test("marks FTSO failures without throwing", async () => {
    const { client } = createMockFtsoClient(() => {
      throw new Error("rpc unavailable");
    });
    const snapshot = await readOptionalFtsoPriceSnapshot({
      ftsoClient: client,
      ftsoV2Address,
      readAt: refreshedAt,
    });

    assert.equal(snapshot.status, "FAILED");
    assert.match(snapshot.error ?? "", /rpc unavailable/);
    assert.equal(snapshot.xrpUsd, null);
  });
});

describe("Agent reliability score refresh", () => {
  test("reads indexed history and inventory from SQLite and persists score rows", async (t) => {
    const database = createTestDatabase(t);
    upsertAgent(database, {
      agentVault: agentVaultA,
      availability: "AVAILABLE",
      availableLots: 12n,
      collateralMetadataJson: JSON.stringify({
        vaultCollateralRatioBIPS: "21000",
        poolCollateralRatioBIPS: "22000",
      }),
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
    });
    upsertAgent(database, {
      agentVault: agentVaultB,
      availability: "UNAVAILABLE",
      availableLots: 0n,
      collateralMetadataJson: JSON.stringify({
        vaultCollateralRatioBIPS: "10000",
      }),
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
    });
    insertRedemptionFixture(database, {
      requestId: "1",
      agentVault: agentVaultA,
      status: "SETTLED",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T01:00:00.000Z",
    });
    insertRedemptionFixture(database, {
      requestId: "2",
      agentVault: agentVaultA,
      status: "SETTLED",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T02:00:00.000Z",
    });
    insertRedemptionFixture(database, {
      requestId: "3",
      agentVault: agentVaultA,
      status: "SETTLED",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T03:00:00.000Z",
    });
    insertRedemptionFixture(database, {
      requestId: "4",
      agentVault: agentVaultA,
      status: "RECOVERED",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T04:00:00.000Z",
    });
    insertRedemptionFixture(database, {
      requestId: "5",
      agentVault: agentVaultB,
      status: "RECOVERED",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T04:00:00.000Z",
    });

    const summary = await refreshAgentReliabilityScores({
      database,
      refreshedAt,
    });
    const scores = listAgentReliabilityScores(database);
    const scoreA = getAgentReliabilityScore(database, agentVaultA);
    const scoreB = getAgentReliabilityScore(database, agentVaultB);
    const agentA = getAgent(database, agentVaultA);
    const components = JSON.parse(scoreA?.componentsJson ?? "{}") as {
      history?: { totalTerminalRedemptions?: number };
    };

    assert.equal(summary.agentsScored, 2);
    assert.equal(summary.ftsoStatus, "UNAVAILABLE");
    assert.equal(scores.length, 2);
    assert.equal(scoreA?.successfulRedemptions, 3);
    assert.equal(scoreA?.defaultedRedemptions, 1);
    assert.equal(scoreA?.averageSettlementSeconds, 7_200);
    assert.equal(scoreA?.collateralRatioBips, 21_000n);
    assert.equal(scoreA?.collateralRatioSource, "INVENTORY");
    assert.ok((scoreA?.score ?? 0) > (scoreB?.score ?? 0));
    assert.equal(agentA?.score.score, scoreA?.score);
    assert.equal(agentA?.score.failedRedemptions, 1);
    assert.equal(components.history?.totalTerminalRedemptions, 4);
  });

  test("uses FTSO-derived valuation when inventory ratios are unavailable", async (t) => {
    const database = createTestDatabase(t);
    const { client } = successfulFtsoClient();
    upsertAgent(database, {
      agentVault: agentVaultC,
      availability: "AVAILABLE",
      availableLots: 1n,
      collateralMetadataJson: JSON.stringify({
        totalPoolCollateralNATWei: "100000000000000000000",
        mintedUBA: "1000000",
      }),
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
    });

    const summary = await refreshAgentReliabilityScores({
      database,
      ftsoClient: client,
      ftsoV2Address,
      refreshedAt,
    });
    const score = getAgentReliabilityScore(database, agentVaultC);
    const components = JSON.parse(score?.componentsJson ?? "{}") as {
      inventory?: { priceDerivedCollateralRatioBips?: string };
    };

    assert.equal(summary.ftsoStatus, "AVAILABLE");
    assert.equal(score?.collateralRatioSource, "FTSO_DERIVED");
    assert.equal(score?.collateralRatioBips, 20_000n);
    assert.equal(score?.ftsoXrpUsdPrice, "0.5");
    assert.equal(
      components.inventory?.priceDerivedCollateralRatioBips,
      "20000",
    );
  });
});
