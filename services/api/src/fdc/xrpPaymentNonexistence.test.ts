import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test, type TestContext } from "node:test";
import fc from "fast-check";

import type { Bytes32, EvmAddress, TransactionHash } from "@harbor/shared";
import { keccak256 } from "viem";

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
  buildAndPersistXrpPaymentNonexistenceRequest,
  createXrpPaymentNonexistenceRequestBody,
  defaultXrpPaymentNonexistenceSourceIdName,
  encodeXrpPaymentNonexistenceRequest,
  standardFirstMemoDataHash,
  xrpPaymentNonexistenceAttestationType,
} from "./xrpPaymentNonexistence.js";
import {
  fdcIdentifier as fdcIdentifierFromStandard,
  standardXrplAddressHash,
} from "./referencedPaymentNonexistence.js";

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
const zeroAddress = "0x0000000000000000000000000000000000000000" as EvmAddress;

function createTestDatabase(t: TestContext): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), "harbor-api-fdc-xrp-"));
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

function insertWithTagRedemptionFixture(
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
    redemptionKind: "WITH_TAG",
    destinationTag: 12345n,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  });
}

describe("XRPPaymentNonexistence FDC request builder", () => {
  test("attestation type and source id match the XRP-native FDC type", () => {
    assert.equal(
      xrpPaymentNonexistenceAttestationType,
      fdcIdentifierFromStandard("XRPPaymentNonexistence"),
    );
    assert.equal(
      fdcIdentifierFromStandard(defaultXrpPaymentNonexistenceSourceIdName),
      fdcIdentifierFromStandard("testXRP"),
    );
  });

  test("standardFirstMemoDataHash is keccak256 of the payment reference bytes", () => {
    assert.equal(
      standardFirstMemoDataHash(paymentReference),
      keccak256(paymentReference),
    );
    // Distinct from the standard path's raw paymentReference.
    assert.notEqual(
      standardFirstMemoDataHash(paymentReference),
      paymentReference,
    );
  });

  test("builds request fields from a WITH_TAG redemption (net amount, both checks, proofOwner zero)", (t) => {
    const database = createTestDatabase(t);
    insertWithTagRedemptionFixture(database);

    const result = buildAndPersistXrpPaymentNonexistenceRequest({
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
      xrpPaymentNonexistenceAttestationType,
    );
    assert.equal(
      result.encodedRequest.sourceIdName,
      defaultXrpPaymentNonexistenceSourceIdName,
    );
    assert.deepEqual(result.encodedRequest.requestBody, {
      minimalBlockNumber: 100n,
      deadlineBlockNumber: 200n,
      deadlineTimestamp: 300n,
      destinationAddressHash: xrplAddressHash,
      amount: 123446n, // valueUBA(123456) - feeUBA(10)
      checkFirstMemoData: true,
      firstMemoDataHash: standardFirstMemoDataHash(paymentReference),
      checkDestinationTag: true,
      destinationTag: 12345n,
      proofOwner: zeroAddress,
    });

    assert.notEqual(result.fdcRequest, null);
    assert.equal(result.fdcRequest?.redemptionRequestId, "42");
    assert.equal(
      result.fdcRequest?.attestationType,
      xrpPaymentNonexistenceAttestationType,
    );
    assert.equal(
      result.fdcRequest?.requestBody,
      result.encodedRequest.requestBytes,
    );
    assert.equal(result.fdcRequest?.status, "PENDING");
  });

  test("encoded request bytes are deterministic and prefixed with attestation||source||mic", () => {
    const request = encodeXrpPaymentNonexistenceRequest({
      messageIntegrityCode,
      requestBody: result2Body(),
    });

    // The request bytes are attestationType || sourceId || messageIntegrityCode
    // || abi-encoded body (all fixed-size 32-byte headers).
    assert.equal(
      request.requestBytes,
      `0x${request.attestationType.slice(2)}${request.sourceId.slice(2)}${request.messageIntegrityCode.slice(2)}${request.encodedRequestBody.slice(2)}`,
    );
    assert.equal(
      request.attestationType,
      xrpPaymentNonexistenceAttestationType,
    );

    // Re-encoding the same body yields the same hash (determinism).
    const reencoded = encodeXrpPaymentNonexistenceRequest({
      messageIntegrityCode,
      requestBody: result2Body(),
    });
    assert.equal(reencoded.requestHash, request.requestHash);
    assert.equal(reencoded.requestBytes, request.requestBytes);
  });

  test("rejects a STANDARD redemption and a missing destination tag", (t) => {
    const database = createTestDatabase(t);
    const standardRedemption = upsertRedemption(database, {
      assetManagerAddress,
      requestId: "43",
      sourceChainId: "114",
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
      redemptionKind: "STANDARD",
      destinationTag: null,
    });

    assert.throws(
      () => createXrpPaymentNonexistenceRequestBody(standardRedemption),
      /not a WITH_TAG redemption/,
    );

    const withoutTag: StoredRedemptionRequest = {
      ...standardRedemption,
      redemptionKind: "WITH_TAG",
      destinationTag: null,
    };
    assert.throws(
      () => createXrpPaymentNonexistenceRequestBody(withoutTag),
      /has no destination tag/,
    );
  });

  test("rejects a destination tag exceeding uint32", (t) => {
    const database = createTestDatabase(t);
    const redemption = insertWithTagRedemptionFixture(database, {
      destinationTag: 0x100000000n,
    });
    assert.throws(
      () => createXrpPaymentNonexistenceRequestBody(redemption),
      /destination tag exceeds uint32/,
    );
  });

  test("blocks builds before the deadline except in dry-run mode", (t) => {
    const database = createTestDatabase(t);
    insertWithTagRedemptionFixture(database);

    assert.throws(
      () =>
        buildAndPersistXrpPaymentNonexistenceRequest({
          database,
          assetManagerAddress,
          requestId: "42",
          messageIntegrityCode,
          currentUnixTimestamp: 300n,
        }),
      /payment deadline has not passed/,
    );
    assert.equal(countRows(database, "fdc_requests"), 0);

    const dryRun = buildAndPersistXrpPaymentNonexistenceRequest({
      database,
      assetManagerAddress,
      requestId: "42",
      messageIntegrityCode,
      currentUnixTimestamp: 300n,
      dryRun: true,
    });

    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.fdcRequest, null);
    assert.equal(countRows(database, "fdc_requests"), 0);
  });

  test("repeated builds upsert the same XDC request record (idempotent)", (t) => {
    const database = createTestDatabase(t);
    insertWithTagRedemptionFixture(database);

    const first = buildAndPersistXrpPaymentNonexistenceRequest({
      database,
      assetManagerAddress,
      requestId: "42",
      messageIntegrityCode,
      currentUnixTimestamp: 301n,
    });
    const second = buildAndPersistXrpPaymentNonexistenceRequest({
      database,
      assetManagerAddress,
      requestId: "42",
      messageIntegrityCode,
      currentUnixTimestamp: 301n,
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

  test("tag 0 is a valid WITH_TAG request (not collapsed to STANDARD)", (t) => {
    const database = createTestDatabase(t);
    insertWithTagRedemptionFixture(database, {
      destinationTag: 0n,
    });

    const result = buildAndPersistXrpPaymentNonexistenceRequest({
      database,
      assetManagerAddress,
      requestId: "42",
      messageIntegrityCode,
      currentUnixTimestamp: 301n,
    });

    assert.equal(result.encodedRequest.requestBody.destinationTag, 0n);
    assert.equal(result.encodedRequest.requestBody.checkDestinationTag, true);
    assert.equal(result.encodedRequest.requestBody.checkFirstMemoData, true);
  });

  test("uses the same standard address hash as the standard path", () => {
    assert.equal(standardXrplAddressHash(xrplAddress), xrplAddressHash);
  });
});

describe("XRPPaymentNonexistence property/fuzz", () => {
  test("destination tag round-trips across the full uint32 range and is rejected above it", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: (1n << 40n) - 1n }), (rawTag) => {
        const inRange = rawTag <= 0xffffffffn;
        const database = openSqliteDatabase(":memory:");
        runMigrations(database);
        const redemption = upsertRedemption(database, {
          assetManagerAddress,
          requestId: "1",
          sourceChainId: "114",
          redeemer,
          agentVault,
          paymentAddress: xrplAddress,
          valueUBA: 1000n,
          feeUBA: 1n,
          paymentReference,
          firstUnderlyingBlock: 1n,
          lastUnderlyingBlock: 2n,
          lastUnderlyingTimestamp: 3n,
          executor,
          executorFeeNatWei: 1n,
          redemptionKind: "WITH_TAG",
          destinationTag: rawTag,
        });

        if (inRange) {
          const body = createXrpPaymentNonexistenceRequestBody(redemption);
          assert.equal(body.destinationTag, rawTag);
          assert.equal(body.checkDestinationTag, true);
          assert.equal(body.checkFirstMemoData, true);
        } else {
          assert.throws(
            () => createXrpPaymentNonexistenceRequestBody(redemption),
            /destination tag exceeds uint32/,
          );
        }
        database.close();
      }),
      { numRuns: 200 },
    );
  });

  test("request hash is deterministic for identical bodies", () => {
    fc.assert(
      fc.property(
        fc.record({
          tag: fc.bigInt({ min: 0n, max: 0xffffffffn }),
          amount: fc.bigInt({ min: 0n, max: 10n ** 18n }),
        }),
        ({ tag, amount }) => {
          const baseBody = {
            minimalBlockNumber: 100n,
            deadlineBlockNumber: 200n,
            deadlineTimestamp: 300n,
            destinationAddressHash: xrplAddressHash,
            amount,
            checkFirstMemoData: true,
            firstMemoDataHash: standardFirstMemoDataHash(paymentReference),
            checkDestinationTag: true,
            destinationTag: tag,
            proofOwner: zeroAddress,
          };
          const a = encodeXrpPaymentNonexistenceRequest({
            messageIntegrityCode,
            requestBody: baseBody,
          });
          const b = encodeXrpPaymentNonexistenceRequest({
            messageIntegrityCode,
            requestBody: baseBody,
          });
          assert.equal(a.requestHash, b.requestHash);
          assert.equal(a.requestBytes, b.requestBytes);
        },
      ),
      { numRuns: 100 },
    );

    // Distinct tag => distinct request bytes/hash (unless tag collides, which
    // uint32 tags never do for distinct in-range values).
    const tag1 = encodeXrpPaymentNonexistenceRequest({
      messageIntegrityCode,
      requestBody: {
        minimalBlockNumber: 100n,
        deadlineBlockNumber: 200n,
        deadlineTimestamp: 300n,
        destinationAddressHash: xrplAddressHash,
        amount: 1000n,
        checkFirstMemoData: true,
        firstMemoDataHash: standardFirstMemoDataHash(paymentReference),
        checkDestinationTag: true,
        destinationTag: 1n,
        proofOwner: zeroAddress,
      },
    });
    const tag2 = encodeXrpPaymentNonexistenceRequest({
      messageIntegrityCode,
      requestBody: {
        minimalBlockNumber: 100n,
        deadlineBlockNumber: 200n,
        deadlineTimestamp: 300n,
        destinationAddressHash: xrplAddressHash,
        amount: 1000n,
        checkFirstMemoData: true,
        firstMemoDataHash: standardFirstMemoDataHash(paymentReference),
        checkDestinationTag: true,
        destinationTag: 2n,
        proofOwner: zeroAddress,
      },
    });
    assert.notEqual(tag1.requestHash, tag2.requestHash);
  });
});

function result2Body() {
  return {
    minimalBlockNumber: 100n,
    deadlineBlockNumber: 200n,
    deadlineTimestamp: 300n,
    destinationAddressHash: xrplAddressHash,
    amount: 123446n,
    checkFirstMemoData: true,
    firstMemoDataHash: standardFirstMemoDataHash(paymentReference),
    checkDestinationTag: true,
    destinationTag: 12345n,
    proofOwner: zeroAddress,
  };
}
