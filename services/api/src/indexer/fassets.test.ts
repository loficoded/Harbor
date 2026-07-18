import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";
import fc from "fast-check";

import { coston2Chain, coston2FxrpAssetManagerAddress } from "@harbor/protocol";
import type { Bytes32, EvmAddress, TransactionHash } from "@harbor/shared";
import { createPublicClient, http, type Chain } from "viem";

import {
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from "../db/index.js";
import {
  getRedemption,
  getSyncCursor,
  type SyncCursorRecord,
} from "../repositories/index.js";
import {
  backfillFAssetEvents,
  indexFAssetEventLogs,
  watchFAssetEvents,
  type ViemDecodedEventLog,
  type ViemEventClient,
} from "./fassets.js";

const chainId = "114";
const assetManagerAddress = `0x${"11".repeat(20)}` as EvmAddress;
const agentVault = `0x${"22".repeat(20)}` as EvmAddress;
const secondAgentVault = `0x${"23".repeat(20)}` as EvmAddress;
const redeemer = `0x${"33".repeat(20)}` as EvmAddress;
const executor = `0x${"44".repeat(20)}` as EvmAddress;
const harborRedeemerAddress = `0x${"55".repeat(20)}` as EvmAddress;
const sourceTransactionHash = `0x${"aa".repeat(32)}` as TransactionHash;
const secondSourceTransactionHash = `0x${"ab".repeat(32)}` as TransactionHash;
const defaultSourceTransactionHash = `0x${"ac".repeat(32)}` as TransactionHash;
const underlyingTransactionHash = `0x${"bb".repeat(32)}` as TransactionHash;
const paymentReference = `0x${"dd".repeat(32)}` as Bytes32;
const observedAt = "2026-07-08T06:00:00.000Z";

type EventRow = Readonly<{
  event_name: string;
  payload_json: string;
}>;

type ContractEventCall = Parameters<ViemEventClient["getContractEvents"]>[0];
type WatchContractEventCall = Parameters<
  ViemEventClient["watchContractEvent"]
>[0];

function createTestDatabase(t: TestContext): SqliteDatabase {
  const database = openSqliteDatabase(":memory:");
  runMigrations(database);

  t.after(() => {
    database.close();
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

function listEventRows(database: SqliteDatabase): readonly EventRow[] {
  return database
    .prepare<[], EventRow>(
      `
SELECT event_name, payload_json
FROM redemption_events
ORDER BY block_number, log_index
`,
    )
    .all();
}

function redemptionRequestedArgs(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    agentVault,
    redeemer,
    requestId: 42n,
    paymentAddress: "rRedeemerDestination",
    valueUBA: 1_000_000n,
    feeUBA: 1_000n,
    firstUnderlyingBlock: 80_000n,
    lastUnderlyingBlock: 80_120n,
    lastUnderlyingTimestamp: 1_783_449_600n,
    paymentReference,
    executor,
    executorFeeNatWei: 50_000_000_000_000_000n,
    ...overrides,
  };
}

function mockLog(
  eventName: string,
  args: Record<string, unknown>,
  overrides: Partial<ViemDecodedEventLog> = {},
): ViemDecodedEventLog {
  return {
    address: assetManagerAddress,
    blockNumber: 100n,
    logIndex: 0,
    transactionHash: sourceTransactionHash,
    transactionIndex: 0,
    eventName,
    args,
    ...overrides,
  };
}

function createBackfillClient(
  logs: readonly ViemDecodedEventLog[],
  options: Readonly<{ failFromBlock?: bigint }> = {},
): ViemEventClient & { calls: ContractEventCall[] } {
  const calls: ContractEventCall[] = [];

  return {
    calls,
    async getContractEvents(parameters) {
      calls.push(parameters);

      if (parameters.fromBlock === options.failFromBlock) {
        throw new Error(`forced failure at block ${parameters.fromBlock}`);
      }

      return logs.filter(
        (log) =>
          log.address.toLowerCase() === parameters.address.toLowerCase() &&
          log.blockNumber !== null &&
          log.blockNumber >= parameters.fromBlock &&
          log.blockNumber <= parameters.toBlock,
      );
    },
    watchContractEvent() {
      throw new Error("watchContractEvent is not used by backfill tests");
    },
  };
}

describe("FAssets event indexer", () => {
  test("indexes RedemptionRequested into one persisted redemption row", (t) => {
    const database = createTestDatabase(t);
    const log = mockLog("RedemptionRequested", redemptionRequestedArgs(), {
      blockNumber: 12_345_678_901_234_567_890n,
      logIndex: 7,
      transactionHash: secondSourceTransactionHash,
      transactionIndex: 2,
    });

    const summary = indexFAssetEventLogs({
      database,
      chainId,
      assetManagerAddress,
      observedAt,
      logs: [log],
    });

    assert.deepEqual(summary, {
      logsProcessed: 1,
      redemptionRequestsIndexed: 1,
      statusUpdatesIndexed: 0,
      metadataEventsIndexed: 0,
      unsupportedEventsIndexed: 0,
      missingRedemptionsForStatusEvents: 0,
    });

    const redemption = getRedemption(database, {
      assetManagerAddress,
      requestId: "42",
    });

    assert.equal(countRows(database, "redemptions"), 1);
    assert.equal(countRows(database, "redemption_events"), 1);
    assert.equal(redemption?.agentVault, agentVault);
    assert.equal(redemption?.redeemer, redeemer);
    assert.equal(redemption?.requestId, "42");
    assert.equal(redemption?.paymentAddress, "rRedeemerDestination");
    assert.equal(redemption?.valueUBA, 1_000_000n);
    assert.equal(redemption?.feeUBA, 1_000n);
    assert.equal(redemption?.firstUnderlyingBlock, 80_000n);
    assert.equal(redemption?.lastUnderlyingBlock, 80_120n);
    assert.equal(redemption?.lastUnderlyingTimestamp, 1_783_449_600n);
    assert.equal(redemption?.paymentReference, paymentReference);
    assert.equal(redemption?.executor, executor);
    assert.equal(redemption?.executorFeeNatWei, 50_000_000_000_000_000n);
    assert.equal(redemption?.sourceChainId, chainId);
    assert.equal(redemption?.sourceBlockNumber, "12345678901234567890");
    assert.equal(redemption?.sourceLogIndex, "7");
    assert.equal(
      redemption?.sourceTransactionHash,
      secondSourceTransactionHash,
    );
    assert.equal(redemption?.status, "REQUESTED");
  });

  test("stores with-tag redemption as a tracked WITH_TAG request, and ticket/Harbor events as metadata", (t) => {
    const database = createTestDatabase(t);

    indexFAssetEventLogs({
      database,
      chainId,
      assetManagerAddress,
      harborRedeemerAddress,
      observedAt,
      logs: [
        mockLog(
          "RedemptionWithTagRequested",
          redemptionRequestedArgs({ requestId: 99n, destinationTag: 12345n }),
          { logIndex: 0 },
        ),
        mockLog(
          "RedemptionTicketCreated",
          {
            agentVault,
            redemptionTicketId: 501n,
            ticketValueUBA: 2_000_000n,
          },
          { logIndex: 1 },
        ),
        mockLog(
          "RedemptionTicketUpdated",
          {
            agentVault,
            redemptionTicketId: 501n,
            ticketValueUBA: 1_000_000n,
          },
          { logIndex: 2 },
        ),
        mockLog(
          "DefaultKeeperExecutorUpdated",
          { executor },
          { address: harborRedeemerAddress, logIndex: 3 },
        ),
        mockLog(
          "OwnershipTransferred",
          { previousOwner: redeemer, newOwner: executor },
          { address: harborRedeemerAddress, logIndex: 4 },
        ),
        mockLog(
          "RedemptionDefaultForwarded",
          {
            caller: executor,
            redemptionRequestId: 99n,
            forwardedExecutorFeeNatWei: 5n,
          },
          { address: harborRedeemerAddress, logIndex: 5 },
        ),
      ],
    });

    // The with-tag event now creates a tracked redemption row (WITH_TAG).
    assert.equal(countRows(database, "redemptions"), 1);
    assert.deepEqual(
      listEventRows(database).map((row) => row.event_name),
      [
        "RedemptionWithTagRequested",
        "RedemptionTicketCreated",
        "RedemptionTicketUpdated",
        "DefaultKeeperExecutorUpdated",
        "OwnershipTransferred",
        "RedemptionDefaultForwarded",
      ],
    );

    const withTagPayload = JSON.parse(
      listEventRows(database)[0]?.payload_json ?? "{}",
    ) as Record<string, unknown>;
    assert.equal(withTagPayload.unsupportedReason, undefined);
    assert.equal(withTagPayload.destinationTag, "12345");

    const redemption = getRedemption(database, {
      assetManagerAddress,
      requestId: "99",
    });
    assert.equal(redemption?.redemptionKind, "WITH_TAG");
    assert.equal(redemption?.destinationTag, 12345n);
    assert.equal(redemption?.status, "REQUESTED");
  });

  test("repeated indexing of the same logs does not duplicate rows", (t) => {
    const database = createTestDatabase(t);
    const log = mockLog("RedemptionRequested", redemptionRequestedArgs());

    indexFAssetEventLogs({
      database,
      chainId,
      assetManagerAddress,
      observedAt,
      logs: [log],
    });
    indexFAssetEventLogs({
      database,
      chainId,
      assetManagerAddress,
      observedAt,
      logs: [log],
    });

    assert.equal(countRows(database, "redemptions"), 1);
    assert.equal(countRows(database, "redemption_events"), 1);
  });

  test("single transaction with multiple RedemptionRequested logs creates one row per request id", (t) => {
    const database = createTestDatabase(t);

    indexFAssetEventLogs({
      database,
      chainId,
      assetManagerAddress,
      observedAt,
      logs: [
        mockLog(
          "RedemptionRequested",
          redemptionRequestedArgs({ requestId: 10n, agentVault }),
          { logIndex: 4, transactionHash: sourceTransactionHash },
        ),
        mockLog(
          "RedemptionRequested",
          redemptionRequestedArgs({
            requestId: 11n,
            agentVault: secondAgentVault,
          }),
          { logIndex: 5, transactionHash: sourceTransactionHash },
        ),
      ],
    });

    const firstRedemption = getRedemption(database, {
      assetManagerAddress,
      requestId: "10",
    });
    const secondRedemption = getRedemption(database, {
      assetManagerAddress,
      requestId: "11",
    });

    assert.equal(countRows(database, "redemptions"), 2);
    assert.equal(firstRedemption?.sourceTransactionHash, sourceTransactionHash);
    assert.equal(
      secondRedemption?.sourceTransactionHash,
      sourceTransactionHash,
    );
    assert.equal(firstRedemption?.agentVault, agentVault);
    assert.equal(secondRedemption?.agentVault, secondAgentVault);
  });

  test("later FAssets events move requested redemptions to settled and defaulted states", (t) => {
    const database = createTestDatabase(t);

    indexFAssetEventLogs({
      database,
      chainId,
      assetManagerAddress,
      observedAt,
      logs: [
        mockLog(
          "RedemptionRequested",
          redemptionRequestedArgs({ requestId: 21n }),
          { logIndex: 0 },
        ),
        mockLog(
          "RedemptionPerformed",
          {
            agentVault,
            redeemer,
            requestId: 21n,
            transactionHash: underlyingTransactionHash,
            redemptionAmountUBA: 999_000n,
            spentUnderlyingUBA: 999_000n,
          },
          { logIndex: 1, transactionHash: secondSourceTransactionHash },
        ),
        mockLog(
          "RedemptionRequested",
          redemptionRequestedArgs({ requestId: 22n }),
          { logIndex: 2 },
        ),
        mockLog(
          "RedemptionDefault",
          {
            agentVault,
            redeemer,
            requestId: 22n,
            redemptionAmountUBA: 999_000n,
            redeemedVaultCollateralWei: 3_000n,
            redeemedPoolCollateralWei: 4_000n,
          },
          { logIndex: 3, transactionHash: defaultSourceTransactionHash },
        ),
      ],
    });

    const settled = getRedemption(database, {
      assetManagerAddress,
      requestId: "21",
    });
    const defaulted = getRedemption(database, {
      assetManagerAddress,
      requestId: "22",
    });

    assert.equal(settled?.status, "SETTLED");
    assert.equal(settled?.transactionHash, underlyingTransactionHash);
    assert.equal(settled?.statusReason, "redemption-performed");
    assert.equal(defaulted?.status, "RECOVERED");
    assert.equal(
      defaulted?.defaultTransactionHash,
      defaultSourceTransactionHash,
    );
    assert.equal(defaulted?.statusReason, "redemption-defaulted");
  });

  test("backfill persists cursor progress and resumes after interruption", async (t) => {
    const database = createTestDatabase(t);
    const cursorName = "test-fassets-backfill";
    const firstLog = mockLog(
      "RedemptionRequested",
      redemptionRequestedArgs({ requestId: 100n }),
      { blockNumber: 100n, logIndex: 0 },
    );
    const laterLog = mockLog(
      "RedemptionRequested",
      redemptionRequestedArgs({ requestId: 104n }),
      { blockNumber: 104n, logIndex: 1 },
    );
    const failingClient = createBackfillClient([firstLog, laterLog], {
      failFromBlock: 102n,
    });

    await assert.rejects(
      backfillFAssetEvents({
        database,
        publicClient: failingClient,
        chainId,
        assetManagerAddress,
        observedAt,
        fromBlock: 100n,
        toBlock: 104n,
        chunkSize: 2n,
        cursorName,
      }),
      /forced failure/,
    );

    const interruptedCursor = getSyncCursor(
      database,
      cursorName,
    ) as SyncCursorRecord;
    assert.equal(interruptedCursor.blockNumber, "101");
    assert.equal(countRows(database, "redemptions"), 1);

    const resumeClient = createBackfillClient([firstLog, laterLog]);
    await backfillFAssetEvents({
      database,
      publicClient: resumeClient,
      chainId,
      assetManagerAddress,
      observedAt,
      fromBlock: 100n,
      toBlock: 104n,
      chunkSize: 2n,
      cursorName,
    });

    assert.equal(resumeClient.calls[0]?.fromBlock, 102n);
    assert.equal(getSyncCursor(database, cursorName)?.blockNumber, "104");
    assert.equal(countRows(database, "redemptions"), 2);
  });

  test("live watcher subscribes to AssetManager and Harbor event streams", (t) => {
    const database = createTestDatabase(t);
    const watchCalls: WatchContractEventCall[] = [];
    let unwatchCallCount = 0;
    const client: ViemEventClient = {
      async getContractEvents() {
        throw new Error("getContractEvents is not used by watch tests");
      },
      watchContractEvent(parameters) {
        watchCalls.push(parameters);
        return () => {
          unwatchCallCount += 1;
        };
      },
    };

    const unwatch = watchFAssetEvents({
      database,
      publicClient: client,
      chainId,
      assetManagerAddress,
      harborRedeemerAddress,
      observedAt,
    });

    assert.equal(watchCalls.length, 2);
    watchCalls[0]?.onLogs([
      mockLog(
        "RedemptionRequested",
        redemptionRequestedArgs({ requestId: 77n }),
      ),
    ]);
    watchCalls[1]?.onLogs([
      mockLog(
        "RedemptionDefaultForwarded",
        {
          caller: executor,
          redemptionRequestId: 77n,
          forwardedExecutorFeeNatWei: 5n,
        },
        { address: harborRedeemerAddress, logIndex: 1 },
      ),
    ]);
    unwatch();

    assert.equal(countRows(database, "redemptions"), 1);
    assert.equal(countRows(database, "redemption_events"), 2);
    assert.equal(unwatchCallCount, 2);
  });

  test(
    "optional live Coston2 smoke test",
    {
      skip:
        process.env.HARBOR_COSTON2_INDEXER_SMOKE === "1"
          ? false
          : "set HARBOR_COSTON2_INDEXER_SMOKE=1 to run",
    },
    async (t) => {
      const database = createTestDatabase(t);
      const publicClient = createPublicClient({
        chain: coston2Chain as Chain,
        transport: http(
          process.env.RPC_URL_COSTON2 ?? coston2Chain.rpcUrls.default.http[0],
        ),
      });
      const latestBlock = await publicClient.getBlockNumber();
      const toBlock =
        process.env.HARBOR_COSTON2_INDEXER_TO_BLOCK === undefined
          ? latestBlock
          : BigInt(process.env.HARBOR_COSTON2_INDEXER_TO_BLOCK);
      const fromBlock =
        process.env.HARBOR_COSTON2_INDEXER_FROM_BLOCK === undefined
          ? toBlock
          : BigInt(process.env.HARBOR_COSTON2_INDEXER_FROM_BLOCK);
      const smokeHarborRedeemerAddress =
        process.env.HARBOR_REDEEMER_ADDRESS === undefined ||
        process.env.HARBOR_REDEEMER_ADDRESS.length === 0
          ? undefined
          : (process.env.HARBOR_REDEEMER_ADDRESS as EvmAddress);

      const summary = await backfillFAssetEvents({
        database,
        publicClient: publicClient as unknown as ViemEventClient,
        chainId,
        assetManagerAddress: coston2FxrpAssetManagerAddress,
        fromBlock,
        toBlock,
        chunkSize: 25n,
        cursorName: "smoke-coston2-fassets-backfill",
        ...(smokeHarborRedeemerAddress === undefined
          ? {}
          : { harborRedeemerAddress: smokeHarborRedeemerAddress }),
      });

      assert.ok(summary.logsProcessed >= 0);
    },
  );
});

describe("FAssets event indexer — redemption-kind routing and fuzz", () => {
  test("RedemptionWithTagRequested is a tracked request, not an unsupported event", (t) => {
    const database = createTestDatabase(t);
    const summary = indexFAssetEventLogs({
      database,
      chainId,
      assetManagerAddress,
      observedAt,
      logs: [
        mockLog(
          "RedemptionWithTagRequested",
          redemptionRequestedArgs({ requestId: 99n, destinationTag: 12345n }),
        ),
      ],
    });

    // Former MVP-skip behavior is gone: the with-tag event counts as an indexed
    // redemption request and never as an unsupported event.
    assert.equal(summary.redemptionRequestsIndexed, 1);
    assert.equal(summary.unsupportedEventsIndexed, 0);
    assert.equal(summary.metadataEventsIndexed, 0);

    const redemption = getRedemption(database, {
      assetManagerAddress,
      requestId: "99",
    });
    assert.equal(redemption?.redemptionKind, "WITH_TAG");
    assert.equal(redemption?.destinationTag, 12345n);
    assert.notEqual(redemption?.destinationTag, null);
  });

  test("RedemptionRequested persists a STANDARD redemption with a null destination tag", (t) => {
    const database = createTestDatabase(t);
    const summary = indexFAssetEventLogs({
      database,
      chainId,
      assetManagerAddress,
      observedAt,
      logs: [
        mockLog(
          "RedemptionRequested",
          redemptionRequestedArgs({ requestId: 7n }),
        ),
      ],
    });

    assert.equal(summary.redemptionRequestsIndexed, 1);
    assert.equal(summary.unsupportedEventsIndexed, 0);
    const redemption = getRedemption(database, {
      assetManagerAddress,
      requestId: "7",
    });
    assert.equal(redemption?.redemptionKind, "STANDARD");
    assert.equal(redemption?.destinationTag, null);
  });

  test("RedemptionAmountIncomplete is a metadata event and does not upsert a redemption", (t) => {
    const database = createTestDatabase(t);
    const summary = indexFAssetEventLogs({
      database,
      chainId,
      assetManagerAddress,
      observedAt,
      logs: [
        mockLog("RedemptionAmountIncomplete", {
          redeemer,
          remainingAmountUBA: 250_000n,
        }),
      ],
    });

    assert.equal(summary.metadataEventsIndexed, 1);
    assert.equal(summary.redemptionRequestsIndexed, 0);
    assert.equal(summary.unsupportedEventsIndexed, 0);
    assert.equal(countRows(database, "redemptions"), 0);
    assert.equal(countRows(database, "redemption_events"), 1);
  });

  test("indexing the same WITH_TAG event twice is idempotent (no duplicate row)", (t) => {
    const database = createTestDatabase(t);
    const logs = [
      mockLog(
        "RedemptionWithTagRequested",
        redemptionRequestedArgs({ requestId: 55n, destinationTag: 7n }),
      ),
    ];
    indexFAssetEventLogs({
      database,
      chainId,
      assetManagerAddress,
      observedAt,
      logs,
    });
    indexFAssetEventLogs({
      database,
      chainId,
      assetManagerAddress,
      observedAt,
      logs,
    });
    assert.equal(countRows(database, "redemptions"), 1);
    assert.equal(countRows(database, "redemption_events"), 1);
    const redemption = getRedemption(database, {
      assetManagerAddress,
      requestId: "55",
    });
    assert.equal(redemption?.destinationTag, 7n);
  });

  test("fuzz: arbitrary event args upsert the correct lane, tag, and amounts", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"STANDARD" | "WITH_TAG">("STANDARD", "WITH_TAG"),
        fc.record({
          requestId: fc.bigInt({ min: 1n, max: 10n ** 12n }),
          value: fc.bigInt({ min: 0n, max: 10n ** 18n }),
          fee: fc.bigInt({ min: 0n, max: 10n ** 18n }),
          tag: fc.bigInt({ min: 0n, max: 0xffffffffn }),
          firstBlock: fc.bigInt({ min: 0n, max: 10n ** 9n }),
        }),
        (kind, r) => {
          const database = openSqliteDatabase(":memory:");
          runMigrations(database);

          const eventName =
            kind === "WITH_TAG"
              ? "RedemptionWithTagRequested"
              : "RedemptionRequested";
          const args = redemptionRequestedArgs({
            requestId: r.requestId,
            valueUBA: r.value,
            feeUBA: r.fee,
            firstUnderlyingBlock: r.firstBlock,
            lastUnderlyingBlock: r.firstBlock + 100n,
            ...(kind === "WITH_TAG" ? { destinationTag: r.tag } : {}),
          });

          indexFAssetEventLogs({
            database,
            chainId,
            assetManagerAddress,
            observedAt,
            logs: [mockLog(eventName, args)],
          });

          const stored = getRedemption(database, {
            assetManagerAddress,
            requestId: String(r.requestId),
          });
          assert.equal(stored?.redemptionKind, kind);
          assert.equal(stored?.valueUBA, r.value);
          assert.equal(stored?.feeUBA, r.fee);
          if (kind === "WITH_TAG") {
            assert.equal(stored?.destinationTag, r.tag);
          } else {
            assert.equal(stored?.destinationTag, null);
          }

          database.close();
        },
      ),
      { numRuns: 200 },
    );
  });
});
