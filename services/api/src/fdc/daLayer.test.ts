import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test, type TestContext } from "node:test";

import { harborRedeemerAbi } from "@harbor/protocol";
import type {
  Bytes32,
  EvmAddress,
  HexString,
  TransactionHash,
} from "@harbor/shared";
import { encodeFunctionData, type Abi } from "viem";

import {
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from "../db/index.js";
import {
  getFdcProofByRequestAndRound,
  getFdcRequest,
  upsertFdcRequest,
} from "../repositories/fdc.js";
import {
  defaultDaLayerProofPath,
  fdcIdentifier,
  normalizeReferencedPaymentNonexistenceProof,
  parseJsonPreservingIntegerStrings,
  requestReferencedPaymentNonexistenceProof,
  retrieveAndPersistReferencedPaymentNonexistenceProof,
  zeroBytes32,
  type DaLayerFetch,
  type DaLayerHttpResponse,
} from "./index.js";

const assetManagerAddress = `0x${"11".repeat(20)}` as EvmAddress;
const transactionHash = `0x${"cc".repeat(32)}` as TransactionHash;
const requestBytes = "0x1234" as HexString;
const attestationType = fdcIdentifier("ReferencedPaymentNonexistence");
const sourceId = fdcIdentifier("testXRP");
const paymentReference = `0x${"dd".repeat(32)}` as Bytes32;
const destinationAddressHash =
  "0x1e2adcb99103f6396903f33db1526fa66aedfbfee4405def0ef69e0fcd949f47" as Bytes32;
const proofNode = `0x${"ef".repeat(32)}` as Bytes32;

function createTestDatabase(t: TestContext): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), "harbor-api-fdc-da-"));
  const databasePath = join(directory, "harbor.sqlite");
  const database = openSqliteDatabase(databasePath);
  runMigrations(database);

  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  return database;
}

function insertFdcRequest(
  database: SqliteDatabase,
  id: string,
  status: "PENDING" | "SUBMITTED" | "FINALIZED" | "FAILED" = "FINALIZED",
): string {
  return upsertFdcRequest(database, {
    fdcRequestId: id,
    redemptionRequestId: "42",
    assetManagerAddress,
    attestationType,
    sourceId,
    sourceChainId: "testXRP",
    requestBody: requestBytesForId(id),
    requestHash: requestHashForId(id),
    status,
    votingRoundId: status === "PENDING" ? null : 321n,
    submissionTransactionHash: status === "PENDING" ? null : transactionHash,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  }).fdcRequestId;
}

function requestHashForId(id: string): Bytes32 {
  const suffix = id.padStart(32, "0").slice(-32);
  return `0x${Buffer.from(suffix).toString("hex").padStart(64, "0").slice(-64)}` as Bytes32;
}

function requestBytesForId(id: string): HexString {
  return `0x${Buffer.from(id).toString("hex")}` as HexString;
}

function proofAvailableJson(votingRound = 321): string {
  return `{
    "response": {
      "attestationType": "${attestationType}",
      "sourceId": "${sourceId}",
      "votingRound": ${votingRound},
      "lowestUsedTimestamp": 18446744073709551615,
      "requestBody": {
        "minimalBlockNumber": 100,
        "deadlineBlockNumber": 200,
        "deadlineTimestamp": 300,
        "destinationAddressHash": "${destinationAddressHash}",
        "amount": 123456,
        "standardPaymentReference": "${paymentReference}",
        "checkSourceAddresses": false,
        "sourceAddressesRoot": "${zeroBytes32}"
      },
      "responseBody": {
        "minimalBlockTimestamp": 301,
        "firstOverflowBlockNumber": 0,
        "firstOverflowBlockTimestamp": 0
      }
    },
    "proof": ["${proofNode}"]
  }`;
}

function httpResponse(
  status: number,
  body: string | unknown,
  headers: Record<string, string | undefined> = {},
): DaLayerHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

describe("DA Layer proof retrieval and normalization", () => {
  test("returns normalized proof calldata when proof data is available", async () => {
    const fetchCalls: Array<{ url: string; body: string }> = [];
    const fetch: DaLayerFetch = async (url, init) => {
      fetchCalls.push({ url, body: init.body });
      return httpResponse(200, proofAvailableJson());
    };

    const result = await requestReferencedPaymentNonexistenceProof({
      baseUrl: "https://example.test",
      votingRoundId: 321n,
      requestBytes,
      fetch,
      retry: {
        maxRetries: 0,
        sleep: async () => {},
      },
    });

    assert.equal(result.status, "PROOF_READY");
    assert.equal(
      fetchCalls[0]?.url,
      `https://example.test${defaultDaLayerProofPath}`,
    );
    assert.deepEqual(JSON.parse(fetchCalls[0]!.body), {
      votingRoundId: 321,
      requestBytes,
    });

    if (result.status !== "PROOF_READY") {
      assert.fail("proof should be ready");
    }

    assert.deepEqual(result.proofCalldata.merkleProof, [proofNode]);
    assert.equal(result.proofCalldata.data.votingRound, 321n);
    assert.equal(
      result.proofCalldata.data.lowestUsedTimestamp,
      18_446_744_073_709_551_615n,
    );
    assert.equal(result.proofCalldata.data.requestBody.amount, 123456n);
    assert.equal(result.encodedResponse.startsWith("0x"), true);
    assert.match(
      result.calldataJson,
      /"lowestUsedTimestamp":"18446744073709551615"/,
    );
  });

  test("normalizes response_hex payloads by decoding the ABI response", () => {
    const normalized = normalizeReferencedPaymentNonexistenceProof(
      parseJsonPreservingIntegerStrings(proofAvailableJson()),
    );
    const fromHex = normalizeReferencedPaymentNonexistenceProof({
      response_hex: normalized.encodedResponse,
      proof: [proofNode],
    });

    assert.deepEqual(fromHex.proofCalldata, normalized.proofCalldata);
    assert.equal(fromHex.encodedResponse, normalized.encodedResponse);
  });

  test("retries proof-not-ready responses and returns NOT_READY after retry budget is exhausted", async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const fetch: DaLayerFetch = async () => {
      attempts += 1;
      return httpResponse(200, { status: "EMPTY" });
    };

    const result = await requestReferencedPaymentNonexistenceProof({
      votingRoundId: 321n,
      requestBytes,
      fetch,
      retry: {
        maxRetries: 1,
        initialDelayMs: 10,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      },
    });

    assert.equal(result.status, "NOT_READY");
    assert.equal(attempts, 2);
    assert.deepEqual(sleeps, [10]);
  });

  test("backs off on DA Layer rate limits", async () => {
    const sleeps: number[] = [];
    const responses = [
      httpResponse(429, "", { "retry-after": "2" }),
      httpResponse(200, proofAvailableJson()),
    ];
    const fetch: DaLayerFetch = async () => responses.shift()!;

    const result = await requestReferencedPaymentNonexistenceProof({
      votingRoundId: 321n,
      requestBytes,
      fetch,
      retry: {
        maxRetries: 1,
        initialDelayMs: 10,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      },
    });

    assert.equal(result.status, "PROOF_READY");
    assert.deepEqual(sleeps, [2_000]);
  });

  test("backs off on transient DA Layer server failures", async () => {
    const sleeps: number[] = [];
    const responses = [
      httpResponse(503, "temporary outage"),
      httpResponse(200, proofAvailableJson()),
    ];
    const fetch: DaLayerFetch = async () => responses.shift()!;

    const result = await requestReferencedPaymentNonexistenceProof({
      votingRoundId: 321n,
      requestBytes,
      fetch,
      retry: {
        maxRetries: 1,
        initialDelayMs: 15,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      },
    });

    assert.equal(result.status, "PROOF_READY");
    assert.deepEqual(sleeps, [15]);
  });

  test("rejects malformed DA Layer proof payloads", async () => {
    const fetch: DaLayerFetch = async () =>
      httpResponse(200, { response: {}, proof: "not-array" });

    await assert.rejects(
      () =>
        requestReferencedPaymentNonexistenceProof({
          votingRoundId: 321n,
          requestBytes,
          fetch,
          retry: { maxRetries: 0, sleep: async () => {} },
        }),
      /proof must be an array/,
    );
  });

  test("normalized proof calldata can be passed to the HarborRedeemer ABI encoder", () => {
    const normalized = normalizeReferencedPaymentNonexistenceProof(
      parseJsonPreservingIntegerStrings(proofAvailableJson()),
    );
    const calldata = encodeFunctionData({
      abi: harborRedeemerAbi as unknown as Abi,
      functionName: "executeDefault",
      args: [normalized.proofCalldata, 42n],
    });

    assert.equal(calldata.startsWith("0x"), true);
  });
});

describe("FDC proof persistence states", () => {
  test("persists pending, submitted, failed, and proof-ready states", async (t) => {
    const database = createTestDatabase(t);
    const pendingId = insertFdcRequest(database, "pending", "PENDING");
    const submittedId = insertFdcRequest(database, "submitted", "SUBMITTED");
    const proofReadyId = insertFdcRequest(database, "proof-ready", "FINALIZED");
    const failedId = insertFdcRequest(database, "failed", "FINALIZED");

    assert.equal(getFdcRequest(database, pendingId)?.status, "PENDING");
    assert.equal(getFdcRequest(database, submittedId)?.status, "SUBMITTED");

    const proofReady =
      await retrieveAndPersistReferencedPaymentNonexistenceProof({
        database,
        fdcRequestId: proofReadyId,
        proofReadyAt: "2026-07-08T00:10:00.000Z",
        fetch: async () => httpResponse(200, proofAvailableJson()),
        retry: { maxRetries: 0, sleep: async () => {} },
      });

    assert.equal(proofReady.status, "PROOF_READY");
    assert.equal(proofReady.fdcRequest.status, "PROOF_READY");
    assert.equal(proofReady.fdcRequest.lastError, null);
    assert.equal(proofReady.fdcRequest.retryCount, 0);
    assert.equal(proofReady.proof.proofReadyAt, "2026-07-08T00:10:00.000Z");
    assert.match(proofReady.proof.proofJson ?? "", /"response"/);
    assert.match(proofReady.proof.calldataJson ?? "", /"merkleProof"/);
    assert.deepEqual(
      getFdcProofByRequestAndRound(database, proofReadyId, 321n)?.merkleProof,
      [proofNode],
    );

    await assert.rejects(
      () =>
        retrieveAndPersistReferencedPaymentNonexistenceProof({
          database,
          fdcRequestId: failedId,
          proofReadyAt: "2026-07-08T00:20:00.000Z",
          fetch: async () => httpResponse(200, { response: {}, proof: "bad" }),
          retry: { maxRetries: 0, sleep: async () => {} },
        }),
      /proof must be an array/,
    );

    const failed = getFdcRequest(database, failedId);
    assert.equal(failed?.status, "FAILED");
    assert.equal(failed?.retryCount, 1);
    assert.equal(failed?.nextRetryAt, "2026-07-08T00:21:00.000Z");
  });

  test("keeps finalized requests pending for retry when DA proof is not ready", async (t) => {
    const database = createTestDatabase(t);
    const fdcRequestId = insertFdcRequest(database, "not-ready", "FINALIZED");

    const result = await retrieveAndPersistReferencedPaymentNonexistenceProof({
      database,
      fdcRequestId,
      proofReadyAt: "2026-07-08T00:30:00.000Z",
      fetch: async () => httpResponse(200, { status: "EMPTY" }),
      retry: { maxRetries: 0, sleep: async () => {} },
    });

    assert.equal(result.status, "NOT_READY");
    assert.equal(result.proof, null);
    assert.equal(result.fdcRequest.status, "FINALIZED");
    assert.equal(result.fdcRequest.retryCount, 1);
    assert.equal(result.fdcRequest.nextRetryAt, "2026-07-08T00:31:00.000Z");
  });
});

test(
  "live Coston2 DA proof smoke is gated by env",
  {
    skip:
      process.env.HARBOR_COSTON2_FDC_DA_SMOKE === "1" &&
      process.env.HARBOR_FDC_SMOKE_VOTING_ROUND_ID !== undefined &&
      process.env.HARBOR_FDC_SMOKE_REQUEST_BYTES !== undefined
        ? false
        : "set HARBOR_COSTON2_FDC_DA_SMOKE=1, HARBOR_FDC_SMOKE_VOTING_ROUND_ID, and HARBOR_FDC_SMOKE_REQUEST_BYTES to run",
  },
  async () => {
    const result = await requestReferencedPaymentNonexistenceProof({
      votingRoundId: BigInt(process.env.HARBOR_FDC_SMOKE_VOTING_ROUND_ID!),
      requestBytes: process.env.HARBOR_FDC_SMOKE_REQUEST_BYTES as HexString,
      baseUrl: process.env.FDC_DA_LAYER_URL,
      apiKey: process.env.FDC_DA_LAYER_API_KEY,
      retry: { maxRetries: 0 },
    });

    assert.equal(result.status, "PROOF_READY");
  },
);
