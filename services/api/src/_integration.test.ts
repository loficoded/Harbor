import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";

import type {
  Bytes32,
  EvmAddress,
  HexString,
  IsoTimestamp,
  TransactionHash,
} from "@harbor/shared";

import {
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from "./db/index.js";
import {
  getRedemption,
  updateFdcRequestStatus,
  updateRedemptionStatus,
} from "./repositories/index.js";
import {
  indexFAssetEventLogs,
  type ViemDecodedEventLog,
} from "./indexer/fassets.js";
import {
  matchXrplPaymentToRedemption,
  persistMatchedXrplPaymentObservation,
} from "./xrpl/paymentObserver.js";
import { isValidXrplObservationForRedemption } from "./keeper/stateMachine.js";
import type { KeeperFdcClient } from "./keeper/stateMachine.js";
import { createSqliteKeeperFdcClient } from "./keeper/sqliteAdapters.js";
import { buildExecuteDefaultParameters } from "./keeper/defaultExecutor.js";
import {
  createXrpPaymentNonexistenceRequestBody,
  xrpPaymentNonexistenceAttestationType,
} from "./fdc/xrpPaymentNonexistence.js";
import { referencedPaymentNonexistenceAttestationType } from "./fdc/referencedPaymentNonexistence.js";
import {
  encodeReferencedPaymentNonexistenceResponse,
  encodeXrpPaymentNonexistenceResponse,
  type DaLayerFetch,
  type ReferencedPaymentNonexistenceResponseData,
  type XrpPaymentNonexistenceResponseData,
} from "./fdc/daLayer.js";
import type { FdcHubPublicClient, FdcHubWalletClient } from "./fdc/hub.js";
import type { FdcReadContractClient } from "./fdc/rounds.js";

/**
 * Cross-layer, end-to-end integration coverage for the redeem-by-tag lifecycle,
 * driven through real SQLite: the FAssets indexer upserts a redemption, the XRPL
 * observer settles (or rejects) a payment, the keeper's FDC client selects and
 * builds the correct non-payment attestation, retrieves the proof through a
 * stubbed DA layer, and the default executor assembles the correct on-chain
 * call. The invariants proven here are the ones that only emerge across module
 * boundaries: lane isolation (WITH_TAG never uses the standard lane and vice
 * versa) and net-amount consistency from event to default.
 */

const chainId = "114";
const assetManagerAddress = `0x${"11".repeat(20)}` as EvmAddress;
const agentVault = `0x${"22".repeat(20)}` as EvmAddress;
const redeemer = `0x${"33".repeat(20)}` as EvmAddress;
const executor = `0x${"44".repeat(20)}` as EvmAddress;
const harborRedeemerAddress = `0x${"55".repeat(20)}` as EvmAddress;
const sourceTransactionHash = `0x${"aa".repeat(32)}` as TransactionHash;
const secondSourceTransactionHash = `0x${"ac".repeat(32)}` as TransactionHash;
const xrplHash = "BB".repeat(32);
const paymentReference = `0x${"dd".repeat(32)}` as Bytes32;
const xrplAddress = "r3wvdzNDkNJ3e5ut1RJfWtBxDHT9sddQRQ";
const messageIntegrityCode = `0x${"ab".repeat(32)}` as Bytes32;
const zeroBytes32 = `0x${"00".repeat(32)}` as Bytes32;
const zeroAddress = "0x0000000000000000000000000000000000000000" as EvmAddress;
const observedAt = "2026-07-08T06:00:00.000Z";

const firstUnderlyingBlock = 490n;
const lastUnderlyingBlock = 510n;
const ledgerIndexInWindow = 500;
const closeTimestampUnixSeconds = 1_783_449_600n;
const lastUnderlyingTimestamp = closeTimestampUnixSeconds + 60n;
const afterDeadline = lastUnderlyingTimestamp + 1n;
const rippleDate = Number(closeTimestampUnixSeconds - 946_684_800n);
const closeTimestampIso = new Date(
  Number(closeTimestampUnixSeconds) * 1_000,
).toISOString();

function createTestDatabase(t: TestContext): SqliteDatabase {
  const database = openSqliteDatabase(":memory:");
  runMigrations(database);
  t.after(() => {
    database.close();
  });
  return database;
}

function redemptionArgs(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    agentVault,
    redeemer,
    requestId: 42n,
    paymentAddress: xrplAddress,
    valueUBA: 1_000_000n,
    feeUBA: 1_000n,
    firstUnderlyingBlock,
    lastUnderlyingBlock,
    lastUnderlyingTimestamp,
    paymentReference,
    executor,
    executorFeeNatWei: 0n,
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

/** Index a single redemption-request event through the real indexer. */
function indexRedemption(
  database: SqliteDatabase,
  eventName: "RedemptionRequested" | "RedemptionWithTagRequested",
  args: Record<string, unknown>,
  logOverrides: Partial<ViemDecodedEventLog> = {},
): void {
  indexFAssetEventLogs({
    database,
    chainId,
    assetManagerAddress,
    observedAt,
    logs: [mockLog(eventName, args, logOverrides)],
  });
}

function requireRedemption(database: SqliteDatabase, requestId = "42") {
  const redemption = getRedemption(database, {
    assetManagerAddress,
    requestId,
  });
  assert.notEqual(redemption, null, "redemption should be indexed");
  return redemption!;
}

/** A valid raw XRPL payment for the standard fixture, with a few overrides. */
function rawPayment(
  overrides: Partial<{
    deliveredAmount: string;
    destinationTag: number | string;
    hasTag: boolean;
  }> = {},
): unknown {
  const includeTag = overrides.hasTag ?? overrides.destinationTag !== undefined;
  return {
    tx: {
      TransactionType: "Payment",
      Account: "rSourceAddress",
      Destination: xrplAddress,
      Amount: overrides.deliveredAmount ?? "999000",
      Fee: "12",
      InvoiceID: paymentReference.slice(2).toUpperCase(),
      date: rippleDate,
      hash: xrplHash,
      ...(includeTag && overrides.destinationTag !== undefined
        ? { DestinationTag: overrides.destinationTag }
        : {}),
    },
    meta: {
      TransactionResult: "tesSUCCESS",
      delivered_amount: overrides.deliveredAmount ?? "999000",
    },
    ledger_index: ledgerIndexInWindow,
    validated: true,
  };
}

const stubPublicClient = {} as unknown as FdcHubPublicClient &
  FdcReadContractClient;
const stubWalletClient = {} as unknown as FdcHubWalletClient;

function makeDaFetch(encodedResponse: HexString): DaLayerFetch {
  return async () => ({
    status: 200,
    ok: true,
    async text() {
      return JSON.stringify({
        proof: [`0x${"01".repeat(32)}`, `0x${"02".repeat(32)}`],
        response_hex: encodedResponse,
      });
    },
  });
}

function keeperFdcClient(
  database: SqliteDatabase,
  daFetch?: DaLayerFetch,
): KeeperFdcClient {
  return createSqliteKeeperFdcClient({
    database,
    messageIntegrityCode,
    publicClient: stubPublicClient,
    walletClient: stubWalletClient,
    ...(daFetch === undefined ? {} : { daLayerFetch: daFetch }),
  });
}

function sampleXrpResponse(
  destinationTag: bigint,
): XrpPaymentNonexistenceResponseData {
  return {
    attestationType: xrpPaymentNonexistenceAttestationType,
    sourceId: `0x${"22".repeat(32)}` as Bytes32,
    votingRound: 7n,
    lowestUsedTimestamp: 1_700_000_000n,
    requestBody: {
      minimalBlockNumber: firstUnderlyingBlock,
      deadlineBlockNumber: lastUnderlyingBlock,
      deadlineTimestamp: lastUnderlyingTimestamp,
      destinationAddressHash: `0x${"04".repeat(32)}` as Bytes32,
      amount: 900n,
      checkFirstMemoData: true,
      firstMemoDataHash: `0x${"05".repeat(32)}` as Bytes32,
      checkDestinationTag: true,
      destinationTag,
      proofOwner: zeroAddress,
    },
    responseBody: {
      minimalBlockTimestamp: 1_699_999_000n,
      firstOverflowBlockNumber: lastUnderlyingBlock + 1n,
      firstOverflowBlockTimestamp: lastUnderlyingTimestamp + 1n,
    },
  };
}

function sampleStandardResponse(): ReferencedPaymentNonexistenceResponseData {
  return {
    attestationType: referencedPaymentNonexistenceAttestationType,
    sourceId: `0x${"22".repeat(32)}` as Bytes32,
    votingRound: 7n,
    lowestUsedTimestamp: 1_700_000_000n,
    requestBody: {
      minimalBlockNumber: firstUnderlyingBlock,
      deadlineBlockNumber: lastUnderlyingBlock,
      deadlineTimestamp: lastUnderlyingTimestamp,
      destinationAddressHash: `0x${"04".repeat(32)}` as Bytes32,
      amount: 900n,
      standardPaymentReference: paymentReference,
      checkSourceAddresses: false,
      sourceAddressesRoot: zeroBytes32,
    },
    responseBody: {
      minimalBlockTimestamp: 1_699_999_000n,
      firstOverflowBlockNumber: lastUnderlyingBlock + 1n,
      firstOverflowBlockTimestamp: lastUnderlyingTimestamp + 1n,
    },
  };
}

const iso: IsoTimestamp = "2026-07-08T07:00:00.000Z";

/**
 * Build the non-payment request through the keeper (real lane selection),
 * finalize its voting round, and retrieve the proof through a stubbed DA layer.
 * Returns the persisted request and proof so callers can assert routing.
 */
async function buildAndRetrieveProof(
  database: SqliteDatabase,
  redemption: ReturnType<typeof requireRedemption>,
  destinationTag: bigint,
) {
  const encoded =
    redemption.redemptionKind === "WITH_TAG"
      ? encodeXrpPaymentNonexistenceResponse(sampleXrpResponse(destinationTag))
      : encodeReferencedPaymentNonexistenceResponse(sampleStandardResponse());
  const client = keeperFdcClient(database, makeDaFetch(encoded));

  const request = await client.buildOrReuseNonPaymentRequest({
    redemption,
    currentUnixTimestamp: afterDeadline,
    createdAt: iso,
    updatedAt: iso,
  });

  const finalized = updateFdcRequestStatus(database, {
    fdcRequestId: request.fdcRequestId,
    status: "FINALIZED",
    votingRoundId: 7n,
    updatedAt: iso,
  });

  const retrieved = await client.retrieveProof({
    request: finalized,
    proofReadyAt: iso,
  });

  return { request, retrieved };
}

// ---------------------------------------------------------------------------
// Settlement lifecycle (indexer -> observer)
// ---------------------------------------------------------------------------

describe("integration: settlement lifecycle", () => {
  test("STANDARD redemption settles from an indexed event and an observed payment", (t) => {
    const database = createTestDatabase(t);
    indexRedemption(database, "RedemptionRequested", redemptionArgs());

    const indexed = requireRedemption(database);
    assert.equal(indexed.redemptionKind, "STANDARD");
    assert.equal(indexed.destinationTag, null);
    assert.equal(indexed.status, "REQUESTED");

    const result = persistMatchedXrplPaymentObservation(
      database,
      indexed,
      rawPayment(),
    );
    assert.equal(result.persisted, true);

    const settled = requireRedemption(database);
    assert.equal(settled.status, "SETTLED");
  });

  test("WITH_TAG settles only on the exact required destination tag", (t) => {
    const database = createTestDatabase(t);
    indexRedemption(
      database,
      "RedemptionWithTagRequested",
      redemptionArgs({ destinationTag: 777n }),
    );

    const indexed = requireRedemption(database);
    assert.equal(indexed.redemptionKind, "WITH_TAG");
    assert.equal(indexed.destinationTag, 777n);

    // A payment carrying the wrong tag is rejected and does not settle.
    const wrong = persistMatchedXrplPaymentObservation(
      database,
      indexed,
      rawPayment({ destinationTag: 778 }),
    );
    assert.equal(wrong.persisted, false);
    if (!wrong.persisted) {
      assert.equal(wrong.reason, "wrong-destination-tag");
    }
    assert.equal(requireRedemption(database).status, "REQUESTED");

    // The exact tag settles.
    const right = persistMatchedXrplPaymentObservation(
      database,
      indexed,
      rawPayment({ destinationTag: 777 }),
    );
    assert.equal(right.persisted, true);
    assert.equal(requireRedemption(database).status, "SETTLED");
  });

  test("tag 0 is a real tag end to end: tag-0 payment settles, an untagged one does not", (t) => {
    const database = createTestDatabase(t);
    indexRedemption(
      database,
      "RedemptionWithTagRequested",
      redemptionArgs({ destinationTag: 0n }),
    );
    const indexed = requireRedemption(database);
    assert.equal(indexed.destinationTag, 0n);

    // The tag-0 proof request carries the tag and both check flags.
    const body = createXrpPaymentNonexistenceRequestBody(indexed);
    assert.equal(body.destinationTag, 0n);
    assert.equal(body.checkDestinationTag, true);

    const untagged = persistMatchedXrplPaymentObservation(
      database,
      indexed,
      rawPayment({ hasTag: false }),
    );
    assert.equal(untagged.persisted, false);
    if (!untagged.persisted) {
      assert.equal(untagged.reason, "wrong-destination-tag");
    }

    const tagged = persistMatchedXrplPaymentObservation(
      database,
      indexed,
      rawPayment({ destinationTag: 0 }),
    );
    assert.equal(tagged.persisted, true);
    assert.equal(requireRedemption(database).status, "SETTLED");
  });

  test("net amount is consistent from indexed event through observer and keeper", (t) => {
    const database = createTestDatabase(t);
    indexRedemption(
      database,
      "RedemptionWithTagRequested",
      redemptionArgs({ valueUBA: 1000n, feeUBA: 100n, destinationTag: 5n }),
    );
    const indexed = requireRedemption(database);

    // Builder attests the net amount (value - fee).
    assert.equal(createXrpPaymentNonexistenceRequestBody(indexed).amount, 900n);

    // Observer requires delivered >= net (900): 899 is insufficient, 900 settles.
    const short = matchXrplPaymentToRedemption(
      indexed,
      rawPayment({ deliveredAmount: "899", destinationTag: 5 }),
    );
    assert.equal(short.matched, false);
    if (!short.matched) {
      assert.equal(short.reason, "insufficient-delivered-amount");
    }

    const exact = persistMatchedXrplPaymentObservation(
      database,
      indexed,
      rawPayment({ deliveredAmount: "900", destinationTag: 5 }),
    );
    assert.equal(exact.persisted, true);

    // Keeper settlement check uses the same net threshold.
    assert.equal(
      isValidXrplObservationForRedemption(indexed, {
        ...exact.observation,
        deliveredAmountUBA: 899n,
      }),
      false,
    );
    assert.equal(
      isValidXrplObservationForRedemption(indexed, exact.observation),
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Default lifecycle (keeper build -> retrieve -> execute), lane isolation
// ---------------------------------------------------------------------------

describe("integration: default lifecycle and lane isolation", () => {
  test("WITH_TAG default builds the XRP attestation and routes to executeXrpDefault", async (t) => {
    const database = createTestDatabase(t);
    indexRedemption(
      database,
      "RedemptionWithTagRequested",
      redemptionArgs({ destinationTag: 777n }),
    );
    const redemption = requireRedemption(database);

    const { request, retrieved } = await buildAndRetrieveProof(
      database,
      redemption,
      777n,
    );

    // Lane selection: the keeper built the XRP-native attestation, never the
    // standard one.
    assert.equal(
      request.attestationType,
      xrpPaymentNonexistenceAttestationType,
    );
    assert.notEqual(
      request.attestationType,
      referencedPaymentNonexistenceAttestationType,
    );
    assert.equal(retrieved.status, "PROOF_READY");
    assert.notEqual(retrieved.proof, null);

    const parameters = buildExecuteDefaultParameters({
      harborRedeemerAddress,
      redemption,
      proof: retrieved.proof!,
    });
    assert.equal(parameters.functionName, "executeXrpDefault");
    assert.equal(parameters.args[1], 42n);
    assert.equal(parameters.args[0].data.requestBody.destinationTag, 777n);
    assert.equal(parameters.args[0].data.requestBody.checkDestinationTag, true);
  });

  test("STANDARD default builds the referenced attestation and routes to executeDefault", async (t) => {
    const database = createTestDatabase(t);
    indexRedemption(database, "RedemptionRequested", redemptionArgs());
    const redemption = requireRedemption(database);

    const { request, retrieved } = await buildAndRetrieveProof(
      database,
      redemption,
      0n,
    );

    assert.equal(
      request.attestationType,
      referencedPaymentNonexistenceAttestationType,
    );
    assert.notEqual(
      request.attestationType,
      xrpPaymentNonexistenceAttestationType,
    );
    assert.equal(retrieved.status, "PROOF_READY");

    const parameters = buildExecuteDefaultParameters({
      harborRedeemerAddress,
      redemption,
      proof: retrieved.proof!,
    });
    assert.equal(parameters.functionName, "executeDefault");
    assert.equal(parameters.args[1], 42n);
  });

  test("lane isolation: WITH_TAG never builds a standard proof and STANDARD never builds an XRP proof", async (t) => {
    const database = createTestDatabase(t);
    indexRedemption(
      database,
      "RedemptionWithTagRequested",
      redemptionArgs({ requestId: 100n, destinationTag: 9n }),
    );
    indexRedemption(
      database,
      "RedemptionRequested",
      redemptionArgs({ requestId: 200n }),
      {
        blockNumber: 101n,
        logIndex: 1,
        transactionHash: secondSourceTransactionHash,
      },
    );

    const client = keeperFdcClient(database);
    const withTag = await client.buildOrReuseNonPaymentRequest({
      redemption: requireRedemption(database, "100"),
      currentUnixTimestamp: afterDeadline,
      createdAt: iso,
      updatedAt: iso,
    });
    const standard = await client.buildOrReuseNonPaymentRequest({
      redemption: requireRedemption(database, "200"),
      currentUnixTimestamp: afterDeadline,
      createdAt: iso,
      updatedAt: iso,
    });

    assert.equal(
      withTag.attestationType,
      xrpPaymentNonexistenceAttestationType,
    );
    assert.equal(
      standard.attestationType,
      referencedPaymentNonexistenceAttestationType,
    );
    assert.notEqual(withTag.attestationType, standard.attestationType);
  });

  test("persistence round-trip: an indexed WITH_TAG redemption survives read, build, and settle", async (t) => {
    const database = createTestDatabase(t);
    indexRedemption(
      database,
      "RedemptionWithTagRequested",
      redemptionArgs({ destinationTag: 4242n }),
    );

    const redemption = requireRedemption(database);
    assert.equal(redemption.redemptionKind, "WITH_TAG");
    assert.equal(redemption.destinationTag, 4242n);
    assert.equal(redemption.paymentAddress, xrplAddress);
    assert.equal(redemption.paymentReference, paymentReference);

    const { request } = await buildAndRetrieveProof(
      database,
      redemption,
      4242n,
    );
    assert.equal(
      request.attestationType,
      xrpPaymentNonexistenceAttestationType,
    );

    const settled = persistMatchedXrplPaymentObservation(
      database,
      redemption,
      rawPayment({ destinationTag: 4242 }),
    );
    assert.equal(settled.persisted, true);
    assert.equal(settled.observation.destinationTag, 4242n);
  });

  test("downgrade safety: a status update without a kind keeps WITH_TAG and its default routing", async (t) => {
    const database = createTestDatabase(t);
    indexRedemption(
      database,
      "RedemptionWithTagRequested",
      redemptionArgs({ destinationTag: 321n }),
    );

    // A later status update that does not carry the kind must not downgrade it.
    updateRedemptionStatus(database, {
      assetManagerAddress,
      requestId: "42",
      status: "WINDOW_EXPIRED",
      statusReason: "window-expired",
      updatedAt: iso,
    });

    const redemption = requireRedemption(database);
    assert.equal(redemption.redemptionKind, "WITH_TAG");
    assert.equal(redemption.destinationTag, 321n);
    assert.equal(redemption.status, "WINDOW_EXPIRED");

    const { retrieved } = await buildAndRetrieveProof(
      database,
      redemption,
      321n,
    );
    const parameters = buildExecuteDefaultParameters({
      harborRedeemerAddress,
      redemption,
      proof: retrieved.proof!,
    });
    assert.equal(parameters.functionName, "executeXrpDefault");
  });
});
