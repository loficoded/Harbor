import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, test, type TestContext } from "node:test";

import type { Bytes32, EvmAddress, TransactionHash } from "@harbor/shared";
import type {
  AccountTxRequest,
  AccountTxResponse,
} from "xrpl/dist/npm/models/methods/index.js";

import {
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from "../db/index.js";
import {
  getRedemption,
  getXrplObservationByTransaction,
  listXrplObservationsForRedemption,
  upsertRedemption,
} from "../repositories/index.js";
import type { StoredRedemptionRequest } from "../repositories/types.js";
import {
  defaultXrplTestnetEndpoint,
  RetryingXrplClient,
  type XrplRequest,
  type XrplTransport,
} from "./client.js";
import {
  backfillRedemptionXrplPayments,
  matchXrplPaymentToRedemption,
  persistMatchedXrplPaymentObservation,
} from "./paymentObserver.js";
import {
  decodeXrplMemoDataCandidates,
  decodeXrplPaymentReferences,
  xrplPaymentReferenceMatches,
} from "./paymentReference.js";

const assetManagerAddress = `0x${"11".repeat(20)}` as EvmAddress;
const agentVault = `0x${"22".repeat(20)}` as EvmAddress;
const redeemer = `0x${"33".repeat(20)}` as EvmAddress;
const sourceTransactionHash = `0x${"aa".repeat(32)}` as TransactionHash;
const paymentReference = `0x${"dd".repeat(32)}` as Bytes32;
const wrongPaymentReference = `0x${"ee".repeat(32)}` as Bytes32;
const xrplTransactionHash = `0x${"bb".repeat(32)}` as TransactionHash;
const xrplHash = "BB".repeat(32);
const paymentAddress = "rDestinationAddress";
const sourceAddress = "rSourceAddress";
const closeTimestampUnixSeconds = 1_783_449_600n;
const rippleCloseTimestampSeconds = closeTimestampUnixSeconds - 946_684_800n;
const closeTimestampIso = new Date(
  Number(closeTimestampUnixSeconds) * 1_000,
).toISOString();

type XrplFixtureOverrides = Partial<{
  hash: string;
  destination: string;
  account: string;
  amount: string;
  deliveredAmount: string | Record<string, unknown>;
  invoiceId: string;
  ledgerIndex: number;
  rippleDate: number;
  transactionResult: string;
  validated: boolean;
}>;

class MockXrplTransport extends EventEmitter {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  requestCalls: XrplRequest[] = [];
  connectFailures = 0;
  requestFailures = 0;
  response: unknown = {
    result: {
      transactions: [],
    },
  };

  async connect(): Promise<void> {
    this.connectCalls += 1;

    if (this.connectFailures > 0) {
      this.connectFailures -= 1;
      throw new Error("forced connect failure");
    }

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async request(request: XrplRequest): Promise<unknown> {
    this.requestCalls.push(request);

    if (this.requestFailures > 0) {
      this.requestFailures -= 1;
      throw new Error("forced request failure");
    }

    return this.response;
  }

  async requestNextPage(
    request: AccountTxRequest,
    response: AccountTxResponse,
  ): Promise<AccountTxResponse> {
    this.requestCalls.push({
      ...request,
      marker: response.result.marker,
    });

    return this.response as AccountTxResponse;
  }
}

function createTestDatabase(t: TestContext): SqliteDatabase {
  const database = openSqliteDatabase(":memory:");
  runMigrations(database);

  t.after(() => {
    database.close();
  });

  return database;
}

function insertRedemptionFixture(
  database: SqliteDatabase,
  overrides: Partial<{
    valueUBA: bigint;
    firstUnderlyingBlock: bigint;
    lastUnderlyingBlock: bigint;
    lastUnderlyingTimestamp: bigint;
    status: StoredRedemptionRequest["status"];
  }> = {},
): StoredRedemptionRequest {
  return upsertRedemption(database, {
    assetManagerAddress,
    requestId: "42",
    sourceChainId: "114",
    sourceBlockNumber: "100",
    sourceLogIndex: "7",
    sourceTransactionHash,
    redeemer,
    agentVault,
    paymentAddress,
    valueUBA: overrides.valueUBA ?? 1_000_000n,
    feeUBA: 1_000n,
    paymentReference,
    firstUnderlyingBlock: overrides.firstUnderlyingBlock ?? 490n,
    lastUnderlyingBlock: overrides.lastUnderlyingBlock ?? 510n,
    lastUnderlyingTimestamp:
      overrides.lastUnderlyingTimestamp ?? closeTimestampUnixSeconds + 60n,
    executor: null,
    executorFeeNatWei: 0n,
    status: overrides.status ?? "WATCHING",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  });
}

function encodeMemoData(value: string): string {
  return Buffer.from(value, "utf8").toString("hex").toUpperCase();
}

function xrplPaymentFixture(overrides: XrplFixtureOverrides = {}) {
  const deliveredAmount =
    overrides.deliveredAmount ?? overrides.amount ?? "1000000";

  return {
    tx: {
      TransactionType: "Payment",
      Account: overrides.account ?? sourceAddress,
      Destination: overrides.destination ?? paymentAddress,
      Amount: overrides.amount ?? "1000000",
      Fee: "12",
      InvoiceID: overrides.invoiceId ?? paymentReference.slice(2).toUpperCase(),
      date: overrides.rippleDate ?? Number(rippleCloseTimestampSeconds),
      hash: overrides.hash ?? xrplHash,
    },
    meta: {
      TransactionResult: overrides.transactionResult ?? "tesSUCCESS",
      delivered_amount: deliveredAmount,
    },
    ledger_index: overrides.ledgerIndex ?? 500,
    validated: overrides.validated ?? true,
  };
}

describe("XRPL payment reference decoding", () => {
  test("decodes payment references from InvoiceID and direct memo hex", () => {
    assert.deepEqual(
      decodeXrplPaymentReferences({
        InvoiceID: paymentReference.slice(2).toUpperCase(),
        Memos: [
          {
            Memo: {
              MemoData: wrongPaymentReference.slice(2).toUpperCase(),
            },
          },
        ],
      }),
      [paymentReference, wrongPaymentReference],
    );
  });

  test("decodes memo data containing an encoded 0x-prefixed reference", () => {
    const memoData = encodeMemoData(paymentReference);

    assert.deepEqual(decodeXrplMemoDataCandidates(memoData), [
      memoData,
      paymentReference,
    ]);
    assert.equal(
      xrplPaymentReferenceMatches(
        {
          Memos: [
            {
              Memo: {
                MemoData: memoData,
              },
            },
          ],
        },
        paymentReference,
      ),
      true,
    );
  });
});

describe("XRPL payment matching", () => {
  test("matches a valid direct XRP payment fixture", (t) => {
    const database = createTestDatabase(t);
    const redemption = insertRedemptionFixture(database);
    const match = matchXrplPaymentToRedemption(
      redemption,
      xrplPaymentFixture(),
    );

    assert.equal(match.matched, true);
    assert.equal(
      match.matched ? match.payment.transactionHash : null,
      xrplTransactionHash,
    );
    assert.equal(
      match.matched ? match.payment.closeTimestamp : null,
      closeTimestampIso,
    );
  });

  test("rejects wrong memo/reference", (t) => {
    const database = createTestDatabase(t);
    const redemption = insertRedemptionFixture(database);
    const match = matchXrplPaymentToRedemption(
      redemption,
      xrplPaymentFixture({
        invoiceId: wrongPaymentReference.slice(2).toUpperCase(),
      }),
    );

    assert.equal(match.matched, false);
    assert.equal(
      match.matched ? null : match.reason,
      "wrong-payment-reference",
    );
  });

  test("rejects wrong destination", (t) => {
    const database = createTestDatabase(t);
    const redemption = insertRedemptionFixture(database);
    const match = matchXrplPaymentToRedemption(
      redemption,
      xrplPaymentFixture({ destination: "rWrongDestination" }),
    );

    assert.equal(match.matched, false);
    assert.equal(match.matched ? null : match.reason, "wrong-destination");
  });

  test("rejects insufficient delivered amount and unsupported IOU amounts", (t) => {
    const database = createTestDatabase(t);
    const redemption = insertRedemptionFixture(database);
    const insufficient = matchXrplPaymentToRedemption(
      redemption,
      xrplPaymentFixture({ deliveredAmount: "999999" }),
    );
    const issuedCurrency = matchXrplPaymentToRedemption(
      redemption,
      xrplPaymentFixture({
        deliveredAmount: {
          currency: "USD",
          issuer: sourceAddress,
          value: "1000000",
        },
      }),
    );

    assert.equal(insufficient.matched, false);
    assert.equal(
      insufficient.matched ? null : insufficient.reason,
      "insufficient-delivered-amount",
    );
    assert.equal(issuedCurrency.matched, false);
    assert.equal(
      issuedCurrency.matched ? null : issuedCurrency.reason,
      "unsupported-delivered-amount",
    );
  });

  test("rejects out-of-window payment by ledger or close timestamp", (t) => {
    const database = createTestDatabase(t);
    const redemption = insertRedemptionFixture(database);
    const lateLedger = matchXrplPaymentToRedemption(
      redemption,
      xrplPaymentFixture({ ledgerIndex: 511 }),
    );
    const lateTimestamp = matchXrplPaymentToRedemption(
      redemption,
      xrplPaymentFixture({
        rippleDate: Number(closeTimestampUnixSeconds + 61n - 946_684_800n),
      }),
    );

    assert.equal(lateLedger.matched, false);
    assert.equal(
      lateLedger.matched ? null : lateLedger.reason,
      "out-of-window",
    );
    assert.equal(lateTimestamp.matched, false);
    assert.equal(
      lateTimestamp.matched ? null : lateTimestamp.reason,
      "out-of-window",
    );
  });

  test("rejects failed transactions", (t) => {
    const database = createTestDatabase(t);
    const redemption = insertRedemptionFixture(database);
    const match = matchXrplPaymentToRedemption(
      redemption,
      xrplPaymentFixture({ transactionResult: "tecPATH_DRY" }),
    );

    assert.equal(match.matched, false);
    assert.equal(match.matched ? null : match.reason, "failed-transaction");
  });
});

describe("XRPL observation persistence", () => {
  test("backfills a matching observation and updates redemption to SETTLED", async (t) => {
    const database = createTestDatabase(t);
    const redemption = insertRedemptionFixture(database);
    const client = {
      async request(request: XrplRequest) {
        assert.equal(request.command, "account_tx");
        assert.equal(request.account, paymentAddress);
        assert.equal(request.ledger_index_min, 490);
        assert.equal(request.ledger_index_max, 510);

        return {
          result: {
            transactions: [
              xrplPaymentFixture({ destination: "rWrongDestination" }),
              xrplPaymentFixture(),
            ],
          },
        };
      },
    };

    const summary = await backfillRedemptionXrplPayments({
      database,
      client,
      redemption,
    });
    const settled = getRedemption(database, {
      assetManagerAddress,
      requestId: "42",
    });
    const observation = getXrplObservationByTransaction(
      database,
      xrplTransactionHash,
      "42",
    );
    const rawReceipt = JSON.parse(observation?.rawJson ?? "{}") as Record<
      string,
      unknown
    >;

    assert.equal(summary.transactionsScanned, 2);
    assert.equal(summary.observationsPersisted, 1);
    assert.equal(summary.redemptionsSettled, 1);
    assert.equal(summary.rejected["wrong-destination"], 1);
    assert.equal(settled?.status, "SETTLED");
    assert.equal(settled?.transactionHash, xrplTransactionHash);
    assert.equal(settled?.statusReason, "xrpl-payment-observed");
    assert.equal(observation?.sourceAddress, sourceAddress);
    assert.equal(observation?.destinationAddress, paymentAddress);
    assert.equal(observation?.deliveredAmountUBA, 1_000_000n);
    assert.equal(observation?.feeDrops, 12n);
    assert.equal(observation?.ledgerIndex, 500n);
    assert.equal(observation?.closeTimestamp, closeTimestampIso);
    assert.equal(rawReceipt.transactionResult, "tesSUCCESS");
    assert.equal(rawReceipt.closeTimestamp, closeTimestampIso);
  });

  test("deduplicates repeated observations", (t) => {
    const database = createTestDatabase(t);
    const redemption = insertRedemptionFixture(database);
    const first = persistMatchedXrplPaymentObservation(
      database,
      redemption,
      xrplPaymentFixture(),
    );
    const second = persistMatchedXrplPaymentObservation(
      database,
      redemption,
      xrplPaymentFixture(),
    );

    assert.equal(first.persisted, true);
    assert.equal(first.persisted ? first.duplicate : null, false);
    assert.equal(second.persisted, true);
    assert.equal(second.persisted ? second.duplicate : null, true);
    assert.equal(listXrplObservationsForRedemption(database, "42").length, 1);
  });
});

describe("retrying XRPL client", () => {
  test("retries connect failures before a request", async () => {
    const transport = new MockXrplTransport();
    transport.connectFailures = 2;
    const client = new RetryingXrplClient("wss://example.invalid", {
      transport: transport as unknown as XrplTransport,
      maxRetries: 2,
      initialDelayMs: 1,
      sleep: async () => {},
    });

    await client.request({
      command: "account_tx",
      account: paymentAddress,
      ledger_index_min: 1,
      ledger_index_max: 2,
    });

    assert.equal(transport.connectCalls, 3);
    assert.equal(transport.requestCalls.length, 1);
  });

  test("reconnects and retries request failures", async () => {
    const transport = new MockXrplTransport();
    transport.requestFailures = 1;
    const client = new RetryingXrplClient("wss://example.invalid", {
      transport: transport as unknown as XrplTransport,
      maxRetries: 1,
      initialDelayMs: 1,
      sleep: async () => {},
    });

    await client.request({
      command: "account_tx",
      account: paymentAddress,
      ledger_index_min: 1,
      ledger_index_max: 2,
    });

    assert.equal(transport.requestCalls.length, 2);
    assert.equal(transport.disconnectCalls, 1);
    assert.equal(transport.connectCalls, 2);
  });

  test("resubscribes after a websocket disconnect", async () => {
    const transport = new MockXrplTransport();
    const client = new RetryingXrplClient("wss://example.invalid", {
      transport: transport as unknown as XrplTransport,
      maxRetries: 1,
      initialDelayMs: 1,
      sleep: async () => {},
    });

    const unsubscribe = await client.subscribeToAccounts(
      [paymentAddress],
      () => {},
    );

    transport.connected = false;
    transport.emit("disconnected", 1006);
    await new Promise((resolve) => setImmediate(resolve));
    await unsubscribe();

    assert.equal(
      transport.requestCalls.filter(
        (request) => request.command === "subscribe",
      ).length,
      2,
    );
    assert.equal(
      transport.requestCalls.filter(
        (request) => request.command === "unsubscribe",
      ).length,
      1,
    );
  });

  test(
    "optional live XRPL testnet smoke test",
    {
      skip:
        process.env.HARBOR_XRPL_TESTNET_SMOKE === "1" &&
        process.env.HARBOR_XRPL_TESTNET_ACCOUNT !== undefined
          ? false
          : "set HARBOR_XRPL_TESTNET_SMOKE=1 and HARBOR_XRPL_TESTNET_ACCOUNT to run",
    },
    async () => {
      const client = new RetryingXrplClient(
        process.env.HARBOR_XRPL_TESTNET_ENDPOINT ?? defaultXrplTestnetEndpoint,
      );

      const response = await client.request({
        command: "account_tx",
        account: process.env.HARBOR_XRPL_TESTNET_ACCOUNT!,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit: 1,
      });

      assert.equal(typeof response, "object");
    },
  );
});
