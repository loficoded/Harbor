import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test, type TestContext } from "node:test";
import fc from "fast-check";

import { netUnderlyingUBA } from "@harbor/shared";
import type { Bytes32, EvmAddress, TransactionHash } from "@harbor/shared";

import {
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from "../db/index.js";
import {
  listFdcRequestsForRedemption,
  upsertRedemption,
} from "../repositories/index.js";
import type { StoredRedemptionRequest } from "../repositories/types.js";
import {
  buildAndPersistReferencedPaymentNonexistenceRequest,
  buildReferencedPaymentNonexistenceRequest,
  createReferencedPaymentNonexistenceRequestBody,
  defaultReferencedPaymentNonexistenceSourceIdName,
  encodeReferencedPaymentNonexistenceRequest,
  fdcIdentifier,
  referencedPaymentNonexistenceAttestationType,
  standardXrplAddressHash,
  zeroBytes32,
} from "./referencedPaymentNonexistence.js";
import { assertDeadlinePassed } from "./encoding.js";

const assetManagerAddress = `0x${"11".repeat(20)}` as EvmAddress;
const agentVault = `0x${"22".repeat(20)}` as EvmAddress;
const redeemer = `0x${"33".repeat(20)}` as EvmAddress;
const executor = `0x${"44".repeat(20)}` as EvmAddress;
const sourceTransactionHash = `0x${"aa".repeat(32)}` as TransactionHash;
const messageIntegrityCode = `0x${"aa".repeat(32)}` as Bytes32;
const paymentReference = `0x${"dd".repeat(32)}` as Bytes32;
const xrplAddress = "r3wvdzNDkNJ3e5ut1RJfWtBxDHT9sddQRQ";
const xrplAddressHash =
  "0x1e2adcb99103f6396903f33db1526fa66aedfbfee4405def0ef69e0fcd949f47" as Bytes32;

function createTestDatabase(t: TestContext): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), "harbor-api-fdc-"));
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

function insertRedemptionFixture(
  database: SqliteDatabase,
  overrides: Partial<Parameters<typeof upsertRedemption>[1]> = {},
): StoredRedemptionRequest {
  return upsertRedemption(database, {
    assetManagerAddress,
    requestId: "42",
    sourceChainId: "114",
    sourceBlockNumber: "1000",
    sourceLogIndex: "7",
    sourceTransactionHash,
    redeemer,
    agentVault,
    paymentAddress: xrplAddress,
    valueUBA: 123456n,
    feeUBA: 10n,
    paymentReference,
    firstUnderlyingBlock: 100n,
    lastUnderlyingBlock: 200n,
    lastUnderlyingTimestamp: 300n,
    executor,
    executorFeeNatWei: 55n,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  });
}

describe("ReferencedPaymentNonexistence FDC request builder", () => {
  test("hashes XRPL classic addresses with the FDC standard address hash", () => {
    assert.equal(standardXrplAddressHash(xrplAddress), xrplAddressHash);
    assert.throws(
      () =>
        standardXrplAddressHash(
          "XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2q1qM6owqNbug8W6KV",
        ),
      /Invalid XRPL classic address/,
    );
  });

  test("builds request fields from a stored redemption row and persists metadata", (t) => {
    const database = createTestDatabase(t);
    insertRedemptionFixture(database);

    const result = buildAndPersistReferencedPaymentNonexistenceRequest({
      database,
      assetManagerAddress,
      requestId: "42",
      messageIntegrityCode,
      currentUnixTimestamp: 301n,
      createdAt: "2026-07-08T00:05:00.000Z",
      updatedAt: "2026-07-08T00:05:00.000Z",
    });

    assert.equal(result.dryRun, false);
    assert.equal(
      result.encodedRequest.attestationType,
      referencedPaymentNonexistenceAttestationType,
    );
    assert.equal(
      result.encodedRequest.sourceId,
      fdcIdentifier(defaultReferencedPaymentNonexistenceSourceIdName),
    );
    assert.deepEqual(result.encodedRequest.requestBody, {
      minimalBlockNumber: 100n,
      deadlineBlockNumber: 200n,
      deadlineTimestamp: 300n,
      destinationAddressHash: xrplAddressHash,
      // Net underlying amount the agent had to deliver: valueUBA (123456) minus
      // feeUBA (10). `redemptionPaymentDefault` asserts the proof amount equals
      // this net value on-chain, so the builder must not encode the gross value.
      amount: 123446n,
      standardPaymentReference: paymentReference,
      checkSourceAddresses: false,
      sourceAddressesRoot: zeroBytes32,
    });

    assert.notEqual(result.fdcRequest, null);
    assert.equal(result.fdcRequest?.redemptionRequestId, "42");
    assert.equal(result.fdcRequest?.assetManagerAddress, assetManagerAddress);
    assert.equal(
      result.fdcRequest?.attestationType,
      referencedPaymentNonexistenceAttestationType,
    );
    assert.equal(
      result.fdcRequest?.requestBody,
      result.encodedRequest.requestBytes,
    );
    assert.equal(
      result.fdcRequest?.requestHash,
      result.encodedRequest.requestHash,
    );
    assert.equal(result.fdcRequest?.sourceChainId, "114");
    assert.equal(result.fdcRequest?.status, "PENDING");
    assert.equal(result.fdcRequest?.createdAt, "2026-07-08T00:05:00.000Z");
  });

  test("matches a golden fixture for encoded request bytes", () => {
    const request = encodeReferencedPaymentNonexistenceRequest({
      messageIntegrityCode,
      requestBody: {
        minimalBlockNumber: 100n,
        deadlineBlockNumber: 200n,
        deadlineTimestamp: 300n,
        destinationAddressHash: xrplAddressHash,
        amount: 123456n,
        standardPaymentReference: paymentReference,
        checkSourceAddresses: false,
        sourceAddressesRoot: zeroBytes32,
      },
    });

    assert.equal(
      request.requestBytes,
      "0x5265666572656e6365645061796d656e744e6f6e6578697374656e63650000007465737458525000000000000000000000000000000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000000000000000000000000000000000000000000000000000000000000006400000000000000000000000000000000000000000000000000000000000000c8000000000000000000000000000000000000000000000000000000000000012c1e2adcb99103f6396903f33db1526fa66aedfbfee4405def0ef69e0fcd949f47000000000000000000000000000000000000000000000000000000000001e240dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    );
    assert.equal(
      request.requestHash,
      "0x6b729734364f917aa4377ca0cdfb330e8e5ed552aeaccdf4167fc7a9a8698878",
    );
  });

  test("rejects missing or invalid required redemption fields", (t) => {
    const database = createTestDatabase(t);
    const redemption = insertRedemptionFixture(database);

    assert.throws(
      () =>
        createReferencedPaymentNonexistenceRequestBody({
          ...redemption,
          paymentAddress: "",
        }),
      /paymentAddress is required/,
    );
    assert.throws(
      () =>
        createReferencedPaymentNonexistenceRequestBody({
          ...redemption,
          valueUBA: undefined as never,
        }),
      /valueUBA is required/,
    );
    assert.throws(
      () =>
        createReferencedPaymentNonexistenceRequestBody({
          ...redemption,
          paymentReference: zeroBytes32,
        }),
      /paymentReference must be non-zero/,
    );
    assert.throws(
      () =>
        createReferencedPaymentNonexistenceRequestBody({
          ...redemption,
          firstUnderlyingBlock: 1n << 64n,
        }),
      /firstUnderlyingBlock exceeds uint64/,
    );
  });

  test("blocks builds before the deadline except in dry-run mode", (t) => {
    const database = createTestDatabase(t);
    insertRedemptionFixture(database);

    assert.throws(
      () =>
        buildAndPersistReferencedPaymentNonexistenceRequest({
          database,
          assetManagerAddress,
          requestId: "42",
          messageIntegrityCode,
          currentUnixTimestamp: 300n,
        }),
      /payment deadline has not passed/,
    );
    assert.equal(countRows(database, "fdc_requests"), 0);

    const dryRun = buildAndPersistReferencedPaymentNonexistenceRequest({
      database,
      assetManagerAddress,
      requestId: "42",
      messageIntegrityCode,
      currentUnixTimestamp: 300n,
      dryRun: true,
    });

    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.fdcRequest, null);
    assert.equal(dryRun.encodedRequest.requestBody.deadlineTimestamp, 300n);
    assert.equal(countRows(database, "fdc_requests"), 0);
  });

  test("repeated builds upsert the same FDC request record", (t) => {
    const database = createTestDatabase(t);
    insertRedemptionFixture(database);

    const first = buildAndPersistReferencedPaymentNonexistenceRequest({
      database,
      assetManagerAddress,
      requestId: "42",
      messageIntegrityCode,
      currentUnixTimestamp: 301n,
      createdAt: "2026-07-08T00:05:00.000Z",
    });
    const second = buildAndPersistReferencedPaymentNonexistenceRequest({
      database,
      assetManagerAddress,
      requestId: "42",
      messageIntegrityCode,
      currentUnixTimestamp: 301n,
      updatedAt: "2026-07-08T00:06:00.000Z",
    });

    assert.equal(countRows(database, "fdc_requests"), 1);
    assert.equal(
      second.fdcRequest?.fdcRequestId,
      first.fdcRequest?.fdcRequestId,
    );
    assert.equal(
      second.fdcRequest?.requestHash,
      first.encodedRequest.requestHash,
    );
    assert.deepEqual(
      listFdcRequestsForRedemption(database, "42").map(
        (request) => request.fdcRequestId,
      ),
      [first.fdcRequest?.fdcRequestId],
    );
  });
});

describe("ReferencedPaymentNonexistence net amount, boundaries, determinism", () => {
  test("encodes the net underlying amount (value - fee) for any value >= fee", (t) => {
    const database = createTestDatabase(t);
    const base = insertRedemptionFixture(database);

    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 18n }),
        fc.bigInt({ min: 0n, max: 10n ** 18n }),
        (a, b) => {
          const valueUBA = a >= b ? a : b;
          const feeUBA = a >= b ? b : a;
          const body = createReferencedPaymentNonexistenceRequestBody({
            ...base,
            valueUBA,
            feeUBA,
          });
          assert.equal(body.amount, netUnderlyingUBA(valueUBA, feeUBA));
          assert.equal(body.amount, valueUBA - feeUBA);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("throws when the fee exceeds the value (negative net)", (t) => {
    const database = createTestDatabase(t);
    const base = insertRedemptionFixture(database);

    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 18n }),
        fc.bigInt({ min: 1n, max: 10n ** 18n }),
        (valueUBA, extra) => {
          const feeUBA = valueUBA + extra; // strictly greater than valueUBA
          assert.throws(
            () =>
              createReferencedPaymentNonexistenceRequestBody({
                ...base,
                valueUBA,
                feeUBA,
              }),
            /cannot be negative/,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  test("net amount boundaries: fee=0 => gross, fee=value => 0, fee=value-1 => 1", (t) => {
    const database = createTestDatabase(t);
    const base = insertRedemptionFixture(database);

    assert.equal(
      createReferencedPaymentNonexistenceRequestBody({
        ...base,
        valueUBA: 1000n,
        feeUBA: 0n,
      }).amount,
      1000n,
    );
    assert.equal(
      createReferencedPaymentNonexistenceRequestBody({
        ...base,
        valueUBA: 1000n,
        feeUBA: 1000n,
      }).amount,
      0n,
    );
    assert.equal(
      createReferencedPaymentNonexistenceRequestBody({
        ...base,
        valueUBA: 1000n,
        feeUBA: 999n,
      }).amount,
      1n,
    );
  });

  test("assertDeadlinePassed enforces the strict deadline boundary and dry-run bypass", (t) => {
    const database = createTestDatabase(t);
    const redemption = insertRedemptionFixture(database); // lastUnderlyingTimestamp = 300n

    // dry-run always bypasses, even before the deadline.
    assert.doesNotThrow(() =>
      assertDeadlinePassed(redemption, {
        currentUnixTimestamp: 0n,
        dryRun: true,
      }),
    );
    // current == deadline => not yet passed.
    assert.throws(
      () =>
        assertDeadlinePassed(redemption, {
          currentUnixTimestamp: redemption.lastUnderlyingTimestamp,
        }),
      /payment deadline has not passed/,
    );
    // current < deadline => not passed.
    assert.throws(
      () =>
        assertDeadlinePassed(redemption, {
          currentUnixTimestamp: redemption.lastUnderlyingTimestamp - 1n,
        }),
      /payment deadline has not passed/,
    );
    // current == deadline + 1 => passes.
    assert.doesNotThrow(() =>
      assertDeadlinePassed(redemption, {
        currentUnixTimestamp: redemption.lastUnderlyingTimestamp + 1n,
      }),
    );
  });

  test("request hash is deterministic and changes when any request-body field changes", (t) => {
    const database = createTestDatabase(t);
    const redemption = insertRedemptionFixture(database);
    const baseBody = createReferencedPaymentNonexistenceRequestBody(redemption);

    const first = encodeReferencedPaymentNonexistenceRequest({
      messageIntegrityCode,
      requestBody: baseBody,
    });
    const second = encodeReferencedPaymentNonexistenceRequest({
      messageIntegrityCode,
      requestBody: baseBody,
    });
    assert.equal(first.requestHash, second.requestHash);
    assert.equal(first.requestBytes, second.requestBytes);

    const otherBytes32 = `0x${"11".repeat(32)}` as Bytes32;
    const mutations: Array<
      Partial<ReturnType<typeof createReferencedPaymentNonexistenceRequestBody>>
    > = [
      { minimalBlockNumber: baseBody.minimalBlockNumber + 1n },
      { deadlineBlockNumber: baseBody.deadlineBlockNumber + 1n },
      { deadlineTimestamp: baseBody.deadlineTimestamp + 1n },
      { destinationAddressHash: otherBytes32 },
      { amount: baseBody.amount + 1n },
      { standardPaymentReference: otherBytes32 },
      { checkSourceAddresses: !baseBody.checkSourceAddresses },
      { sourceAddressesRoot: otherBytes32 },
    ];

    for (const mutation of mutations) {
      const mutated = encodeReferencedPaymentNonexistenceRequest({
        messageIntegrityCode,
        requestBody: { ...baseBody, ...mutation },
      });
      assert.notEqual(
        mutated.requestHash,
        first.requestHash,
        `mutating ${Object.keys(mutation).join(",")} should change the request hash`,
      );
    }
  });

  test("matches a golden fixture for the net-amount encoded request bytes", (t) => {
    const database = createTestDatabase(t);
    const redemption = insertRedemptionFixture(database); // value 123456, fee 10 => net 123446
    const encoded = buildReferencedPaymentNonexistenceRequest(redemption, {
      messageIntegrityCode,
      currentUnixTimestamp: 301n,
    });

    assert.equal(encoded.requestBody.amount, 123446n);
    assert.equal(
      encoded.requestBytes,
      "0x5265666572656e6365645061796d656e744e6f6e6578697374656e63650000007465737458525000000000000000000000000000000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000000000000000000000000000000000000000000000000000000000000006400000000000000000000000000000000000000000000000000000000000000c8000000000000000000000000000000000000000000000000000000000000012c1e2adcb99103f6396903f33db1526fa66aedfbfee4405def0ef69e0fcd949f47000000000000000000000000000000000000000000000000000000000001e236dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    );
    assert.equal(
      encoded.requestHash,
      "0x254cf149293bf787e1a1c41dca1ad39ea459b816a1bb7f4a9fa89e82baf50029",
    );
  });
});
