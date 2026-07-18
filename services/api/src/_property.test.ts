import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";

import {
  destinationTagMax,
  netUnderlyingUBA,
  normalizeDestinationTag,
  type Bytes32,
  type EvmAddress,
  type TransactionHash,
} from "@harbor/shared";

import {
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from "./db/index.js";
import { upsertRedemption } from "./repositories/redemptions.js";
import { upsertXrplObservation } from "./repositories/xrplObservations.js";
import type {
  StoredRedemptionRequest,
  StoredXrplPaymentObservation,
} from "./repositories/types.js";
import { createReferencedPaymentNonexistenceRequestBody } from "./fdc/referencedPaymentNonexistence.js";
import { createXrpPaymentNonexistenceRequestBody } from "./fdc/xrpPaymentNonexistence.js";
import {
  decodeXrpPaymentNonexistenceResponse,
  encodeXrpPaymentNonexistenceResponse,
  normalizeXrpPaymentNonexistenceResponse,
  type XrpPaymentNonexistenceResponseData,
} from "./fdc/daLayer.js";
import {
  matchXrplPaymentToRedemption,
  normalizeXrplPayment,
} from "./xrpl/paymentObserver.js";
import { isValidXrplObservationForRedemption } from "./keeper/stateMachine.js";

/**
 * Cross-cutting property/fuzz and negative-input coverage for the redeem-by-tag
 * feature. These are intentionally *not* per-module unit tests: they assert the
 * invariants that must hold across module boundaries — above all that the single
 * `netUnderlyingUBA` source of truth is used identically at all four amount
 * sites (both FDC proof builders, the XRPL observer, and the keeper settlement
 * check) so a delivered payment is always matched against the net, never the
 * gross, value.
 */

const assetManagerAddress = `0x${"11".repeat(20)}` as EvmAddress;
const agentVault = `0x${"22".repeat(20)}` as EvmAddress;
const redeemer = `0x${"33".repeat(20)}` as EvmAddress;
const executor = `0x${"44".repeat(20)}` as EvmAddress;
const sourceTransactionHash = `0x${"aa".repeat(32)}` as TransactionHash;
const xrplTransactionHash = `0x${"bb".repeat(32)}` as TransactionHash;
const xrplHash = "BB".repeat(32);
const paymentReference = `0x${"dd".repeat(32)}` as Bytes32;
// A real XRPL classic address so the FDC address-hash builder accepts it.
const xrplAddress = "r3wvdzNDkNJ3e5ut1RJfWtBxDHT9sddQRQ";
const zeroBytes32 = `0x${"00".repeat(32)}` as Bytes32;
const zeroAddress = "0x0000000000000000000000000000000000000000" as EvmAddress;

const firstUnderlyingBlock = 490n;
const lastUnderlyingBlock = 510n;
const ledgerIndexInWindow = 500n;
const closeTimestampUnixSeconds = 1_783_449_600n;
const lastUnderlyingTimestamp = closeTimestampUnixSeconds + 60n;
const rippleDate = Number(closeTimestampUnixSeconds - 946_684_800n);
const closeTimestampIso = new Date(
  Number(closeTimestampUnixSeconds) * 1_000,
).toISOString();

/**
 * Build a base stored redemption + observation once (through real SQLite so the
 * shapes are authentic), then spread per-iteration overrides in the properties.
 * The pure functions under test operate on these objects, not the database, so
 * no per-run DB round-trip is needed.
 */
function buildBaseObjects(): {
  redemption: StoredRedemptionRequest;
  observation: StoredXrplPaymentObservation;
} {
  const database: SqliteDatabase = openSqliteDatabase(":memory:");
  runMigrations(database);

  const redemption = upsertRedemption(database, {
    assetManagerAddress,
    requestId: "42",
    sourceChainId: "114",
    sourceBlockNumber: "100",
    sourceLogIndex: "7",
    sourceTransactionHash,
    redeemer,
    agentVault,
    paymentAddress: xrplAddress,
    valueUBA: 1_000_000n,
    feeUBA: 1_000n,
    paymentReference,
    firstUnderlyingBlock,
    lastUnderlyingBlock,
    lastUnderlyingTimestamp,
    executor,
    executorFeeNatWei: 0n,
    status: "WATCHING",
    redemptionKind: "STANDARD",
    destinationTag: null,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  });

  const observation = upsertXrplObservation(database, {
    observationId: "obs-42-0",
    redemptionRequestId: "42",
    assetManagerAddress,
    transactionHash: xrplTransactionHash,
    sourceAddress: "rSourceAddress",
    destinationAddress: xrplAddress,
    deliveredAmountUBA: 999_000n,
    feeDrops: 12n,
    paymentReference,
    ledgerIndex: ledgerIndexInWindow,
    closeTimestamp: closeTimestampIso,
    validatedAt: closeTimestampIso,
    destinationTag: null,
    rawJson: null,
  });

  database.close();
  return { redemption, observation };
}

const { redemption: baseRedemption, observation: baseObservation } =
  buildBaseObjects();

/** A valid raw XRPL payment for the base redemption, overriding a few fields. */
function rawPayment(
  overrides: Partial<{
    deliveredAmount: string;
    destinationTag: number | string;
  }> = {},
): unknown {
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
      ...(overrides.destinationTag === undefined
        ? {}
        : { DestinationTag: overrides.destinationTag }),
    },
    meta: {
      TransactionResult: "tesSUCCESS",
      delivered_amount: overrides.deliveredAmount ?? "999000",
    },
    ledger_index: Number(ledgerIndexInWindow),
    validated: true,
  };
}

// ---------------------------------------------------------------------------
// Net-amount consistency across all four sites
// ---------------------------------------------------------------------------

describe("net-amount consistency across the four amount sites", () => {
  test("netUnderlyingUBA is exactly value - fee for any value >= fee", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 24n }),
        fc.bigInt({ min: 0n, max: 10n ** 24n }),
        (a, b) => {
          const valueUBA = a >= b ? a : b;
          const feeUBA = a >= b ? b : a;
          assert.equal(netUnderlyingUBA(valueUBA, feeUBA), valueUBA - feeUBA);
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("both proof builders, the observer, and the keeper agree on the net amount", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 18n }),
        fc.bigInt({ min: 0n, max: 10n ** 18n }),
        fc.bigInt({ min: 0n, max: destinationTagMax }),
        (value, feeSeed, tag) => {
          const valueUBA = value;
          const feeUBA = feeSeed % (value + 1n); // 0 <= fee <= value
          const net = netUnderlyingUBA(valueUBA, feeUBA);

          // Site 1: standard ReferencedPaymentNonexistence builder.
          const standardBody = createReferencedPaymentNonexistenceRequestBody({
            ...baseRedemption,
            valueUBA,
            feeUBA,
            redemptionKind: "STANDARD",
            destinationTag: null,
          });
          assert.equal(standardBody.amount, net);

          // Site 2: XRP-native XRPPaymentNonexistence builder.
          const xrpBody = createXrpPaymentNonexistenceRequestBody({
            ...baseRedemption,
            valueUBA,
            feeUBA,
            redemptionKind: "WITH_TAG",
            destinationTag: tag,
          });
          assert.equal(xrpBody.amount, net);

          // Site 3: XRPL settlement observer requires delivered >= net.
          const redemptionForMatch = {
            ...baseRedemption,
            valueUBA,
            feeUBA,
          };
          const matched = matchXrplPaymentToRedemption(
            redemptionForMatch,
            rawPayment({ deliveredAmount: net.toString() }),
          );
          assert.equal(matched.matched, true);

          if (net > 0n) {
            const short = matchXrplPaymentToRedemption(
              redemptionForMatch,
              rawPayment({ deliveredAmount: (net - 1n).toString() }),
            );
            assert.equal(short.matched, false);
            if (!short.matched) {
              assert.equal(short.reason, "insufficient-delivered-amount");
            }
          }

          // Site 4: keeper settlement check uses the same net threshold.
          assert.equal(
            isValidXrplObservationForRedemption(redemptionForMatch, {
              ...baseObservation,
              deliveredAmountUBA: net,
            }),
            true,
          );
          if (net > 0n) {
            assert.equal(
              isValidXrplObservationForRedemption(redemptionForMatch, {
                ...baseObservation,
                deliveredAmountUBA: net - 1n,
              }),
              false,
            );
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Destination-tag normalization (property sweep)
// ---------------------------------------------------------------------------

describe("normalizeDestinationTag property sweep", () => {
  test("any uint32 round-trips identically from bigint, number, and string", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: destinationTagMax }), (tag) => {
        assert.equal(normalizeDestinationTag(tag), tag);
        assert.equal(normalizeDestinationTag(tag.toString()), tag);
        if (tag <= BigInt(Number.MAX_SAFE_INTEGER)) {
          assert.equal(normalizeDestinationTag(Number(tag)), tag);
        }
      }),
      { numRuns: 1000 },
    );
  });

  test("any value strictly above uint32 normalizes to null", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: destinationTagMax + 1n, max: 1n << 96n }),
        (tooLarge) => {
          assert.equal(normalizeDestinationTag(tooLarge), null);
          assert.equal(normalizeDestinationTag(tooLarge.toString()), null);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("negative bigints never normalize to a tag", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(1n << 64n), max: -1n }), (negative) => {
        assert.equal(normalizeDestinationTag(negative), null);
      }),
      { numRuns: 500 },
    );
  });

  test("10000-iteration deterministic sweep: round-trip holds for every sampled tag", () => {
    for (let index = 0; index < 10_000; index += 1) {
      // Spread samples across the whole uint32 range (endpoints included).
      const tag = BigInt(index) * 429_496n;
      const inRange = tag <= destinationTagMax;
      assert.equal(normalizeDestinationTag(tag), inRange ? tag : null);
    }
    assert.equal(normalizeDestinationTag(0n), 0n);
    assert.equal(normalizeDestinationTag(destinationTagMax), destinationTagMax);
  });
});

// ---------------------------------------------------------------------------
// XRP proof encode -> decode -> normalize round-trip (property)
// ---------------------------------------------------------------------------

describe("XRPPaymentNonexistence response round-trip (property)", () => {
  test("encode -> decode -> normalize preserves every field for any valid response", () => {
    const uint64 = fc.bigInt({ min: 0n, max: (1n << 64n) - 1n });
    fc.assert(
      fc.property(
        fc.record({
          votingRound: uint64,
          lowestUsedTimestamp: uint64,
          minimalBlockNumber: uint64,
          deadlineBlockNumber: uint64,
          deadlineTimestamp: uint64,
          amount: fc.bigInt({ min: 0n, max: 10n ** 30n }),
          destinationTag: fc.bigInt({ min: 0n, max: destinationTagMax }),
          checkFirstMemoData: fc.boolean(),
          checkDestinationTag: fc.boolean(),
          minimalBlockTimestamp: uint64,
          firstOverflowBlockNumber: uint64,
          firstOverflowBlockTimestamp: uint64,
        }),
        (fields) => {
          const original: XrpPaymentNonexistenceResponseData = {
            attestationType: `0x${"09".repeat(32)}` as Bytes32,
            sourceId: `0x${"22".repeat(32)}` as Bytes32,
            votingRound: fields.votingRound,
            lowestUsedTimestamp: fields.lowestUsedTimestamp,
            requestBody: {
              minimalBlockNumber: fields.minimalBlockNumber,
              deadlineBlockNumber: fields.deadlineBlockNumber,
              deadlineTimestamp: fields.deadlineTimestamp,
              destinationAddressHash: `0x${"04".repeat(32)}` as Bytes32,
              amount: fields.amount,
              checkFirstMemoData: fields.checkFirstMemoData,
              firstMemoDataHash: `0x${"05".repeat(32)}` as Bytes32,
              checkDestinationTag: fields.checkDestinationTag,
              destinationTag: fields.destinationTag,
              proofOwner: zeroAddress,
            },
            responseBody: {
              minimalBlockTimestamp: fields.minimalBlockTimestamp,
              firstOverflowBlockNumber: fields.firstOverflowBlockNumber,
              firstOverflowBlockTimestamp: fields.firstOverflowBlockTimestamp,
            },
          };

          const roundTripped = normalizeXrpPaymentNonexistenceResponse(
            decodeXrpPaymentNonexistenceResponse(
              encodeXrpPaymentNonexistenceResponse(original),
            ),
          );
          assert.deepEqual(roundTripped, original);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Matching never throws for valid, widely-varied inputs
// ---------------------------------------------------------------------------

describe("matchXrplPaymentToRedemption robustness (property)", () => {
  test("returns a matched/reason result and never throws for any valid redemption + payment", () => {
    fc.assert(
      fc.property(
        fc.record({
          kind: fc.constantFrom("STANDARD", "WITH_TAG"),
          tag: fc.bigInt({ min: 0n, max: destinationTagMax }),
          value: fc.bigInt({ min: 1n, max: 10n ** 18n }),
          feeSeed: fc.bigInt({ min: 0n, max: 10n ** 18n }),
          delivered: fc.bigInt({ min: 0n, max: 10n ** 18n }),
          paymentTag: fc.option(fc.integer({ min: 0, max: 4_294_967_295 }), {
            nil: undefined,
          }),
          ledger: fc.integer({ min: 0, max: 1_000_000 }),
        }),
        (sample) => {
          const feeUBA = sample.feeSeed % (sample.value + 1n);
          const redemption: StoredRedemptionRequest = {
            ...baseRedemption,
            valueUBA: sample.value,
            feeUBA,
            redemptionKind: sample.kind,
            destinationTag: sample.kind === "WITH_TAG" ? sample.tag : null,
          };
          const raw = {
            tx: {
              TransactionType: "Payment",
              Account: "rSourceAddress",
              Destination: xrplAddress,
              Amount: sample.delivered.toString(),
              Fee: "12",
              InvoiceID: paymentReference.slice(2).toUpperCase(),
              date: rippleDate,
              hash: xrplHash,
              ...(sample.paymentTag === undefined
                ? {}
                : { DestinationTag: sample.paymentTag }),
            },
            meta: {
              TransactionResult: "tesSUCCESS",
              delivered_amount: sample.delivered.toString(),
            },
            ledger_index: sample.ledger,
            validated: true,
          };

          const result = matchXrplPaymentToRedemption(redemption, raw);
          assert.equal(typeof result.matched, "boolean");
          if (!result.matched) {
            assert.equal(typeof result.reason, "string");
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Negative / malformed inputs
// ---------------------------------------------------------------------------

describe("negative and malformed inputs", () => {
  test("normalizeXrplPayment returns null (never throws) for non-payment shapes", () => {
    for (const bad of [
      null,
      undefined,
      [],
      "",
      "not-json",
      42,
      {},
      [1, 2, 3],
    ]) {
      assert.equal(normalizeXrplPayment(bad as unknown), null);
    }
  });

  test("an 'unavailable' delivered_amount is rejected as unsupported, not coerced", () => {
    const result = matchXrplPaymentToRedemption(
      baseRedemption,
      rawPayment({ deliveredAmount: "unavailable" }),
    );
    assert.equal(result.matched, false);
    if (!result.matched) {
      assert.equal(result.reason, "unsupported-delivered-amount");
    }
  });

  test("the XRP builder rejects a zero payment reference", () => {
    assert.throws(
      () =>
        createXrpPaymentNonexistenceRequestBody({
          ...baseRedemption,
          redemptionKind: "WITH_TAG",
          destinationTag: 7n,
          paymentReference: zeroBytes32,
        }),
      /paymentReference must be non-zero/,
    );
  });

  test("the XRP builder rejects an empty payment address", () => {
    assert.throws(
      () =>
        createXrpPaymentNonexistenceRequestBody({
          ...baseRedemption,
          redemptionKind: "WITH_TAG",
          destinationTag: 7n,
          paymentAddress: "",
        }),
      /paymentAddress is required/,
    );
  });
});
