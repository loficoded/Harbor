import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test, type TestContext } from "node:test";

import {
  coston2Chain,
  coston2FdcHubAddress,
  coston2RelayAddress,
  fdcHubAbi,
  fdcRequestFeeConfigurationsAbi,
  relayAbi,
} from "@harbor/protocol";
import type {
  Bytes32,
  EvmAddress,
  HexString,
  TransactionHash,
} from "@harbor/shared";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from "../db/index.js";
import { getFdcRequest, upsertFdcRequest } from "../repositories/fdc.js";
import {
  calculateVotingRoundIdFromTiming,
  checkFdcVotingRoundFinalization,
  coston2StaticVotingRoundTiming,
  fdcProtocolId,
  submitFdcAttestationRequest,
  submitStoredFdcRequest,
  waitForFdcVotingRoundFinalization,
  type FdcReadContractClient,
  type FdcHubPublicClient,
  type FdcHubWalletClient,
} from "./index.js";

const requestBytes = "0x1234" as HexString;
const requestHash = `0x${"ab".repeat(32)}` as Bytes32;
const attestationType = `0x${"01".repeat(32)}` as Bytes32;
const sourceId = `0x${"02".repeat(32)}` as Bytes32;
const assetManagerAddress = `0x${"11".repeat(20)}` as EvmAddress;
const feeConfigurationsAddress = `0x${"44".repeat(20)}` as EvmAddress;
const transactionHash = `0x${"cc".repeat(32)}` as TransactionHash;

function createTestDatabase(t: TestContext): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), "harbor-api-fdc-submit-"));
  const databasePath = join(directory, "harbor.sqlite");
  const database = openSqliteDatabase(databasePath);
  runMigrations(database);

  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  return database;
}

function insertFdcRequest(database: SqliteDatabase): string {
  return upsertFdcRequest(database, {
    fdcRequestId: "fdc-request-submit",
    redemptionRequestId: "42",
    assetManagerAddress,
    attestationType,
    sourceId,
    sourceChainId: "testXRP",
    requestBody: requestBytes,
    requestHash,
    status: "PENDING",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  }).fdcRequestId;
}

describe("FDC Hub submission and voting round tracking", () => {
  test("submits encoded request bytes through the pinned Coston2 FDC Hub and persists submission metadata", async (t) => {
    const database = createTestDatabase(t);
    const fdcRequestId = insertFdcRequest(database);
    const readCalls: Array<{
      address: string;
      abi: Abi;
      functionName: string;
      args?: readonly unknown[];
    }> = [];
    const writeCalls: Parameters<FdcHubWalletClient["writeContract"]>[0][] = [];
    const publicClient: FdcHubPublicClient = {
      async readContract(parameters) {
        readCalls.push(parameters);

        if (parameters.functionName === "fdcRequestFeeConfigurations") {
          return feeConfigurationsAddress;
        }

        if (parameters.functionName === "getRequestFee") {
          return 123n;
        }

        if (parameters.functionName === "getVotingRoundId") {
          return 777n;
        }

        throw new Error(`Unexpected read: ${parameters.functionName}`);
      },
      async waitForTransactionReceipt(parameters) {
        assert.equal(parameters.hash, transactionHash);
        return { status: "success", blockNumber: 99n };
      },
      async getBlock(parameters) {
        assert.equal(parameters.blockNumber, 99n);
        return { timestamp: 1_758_000_001n };
      },
    };
    const walletClient: FdcHubWalletClient = {
      async writeContract(parameters) {
        writeCalls.push(parameters);
        return transactionHash;
      },
    };

    const updated = await submitStoredFdcRequest({
      database,
      fdcRequestId,
      publicClient,
      walletClient,
      updatedAt: "2026-07-08T00:01:00.000Z",
    });

    assert.equal(updated.status, "SUBMITTED");
    assert.equal(updated.submissionTransactionHash, transactionHash);
    assert.equal(updated.votingRoundId, 777n);
    assert.equal(updated.retryCount, 0);
    assert.equal(updated.lastError, null);
    assert.equal(writeCalls.length, 1);
    assert.equal(writeCalls[0]?.address, coston2FdcHubAddress);
    assert.equal(writeCalls[0]?.abi, fdcHubAbi as unknown as Abi);
    assert.equal(writeCalls[0]?.functionName, "requestAttestation");
    assert.deepEqual(writeCalls[0]?.args, [requestBytes]);
    assert.equal(writeCalls[0]?.value, 123n);
    assert.equal(readCalls[0]?.address, coston2FdcHubAddress);
    assert.equal(readCalls[1]?.address, feeConfigurationsAddress);
    assert.equal(
      readCalls[1]?.abi,
      fdcRequestFeeConfigurationsAbi as unknown as Abi,
    );
    assert.equal(readCalls[2]?.address, coston2RelayAddress);
    assert.equal(readCalls[2]?.abi, relayAbi as unknown as Abi);
  });

  test("records submission failures with retry metadata", async (t) => {
    const database = createTestDatabase(t);
    const fdcRequestId = insertFdcRequest(database);
    const publicClient: FdcHubPublicClient = {
      async readContract() {
        return 777n;
      },
      async waitForTransactionReceipt() {
        return { status: "success", blockNumber: 99n };
      },
      async getBlock() {
        return { timestamp: 1_758_000_001n };
      },
    };
    const walletClient: FdcHubWalletClient = {
      async writeContract() {
        throw new Error("wallet temporarily unavailable");
      },
    };

    await assert.rejects(
      () =>
        submitStoredFdcRequest({
          database,
          fdcRequestId,
          publicClient,
          walletClient,
          requestFeeWei: 123n,
          updatedAt: "2026-07-08T00:01:00.000Z",
        }),
      /wallet temporarily unavailable/,
    );

    const failed = getFdcRequest(database, fdcRequestId);
    assert.equal(failed?.status, "FAILED");
    assert.equal(failed?.lastError, "wallet temporarily unavailable");
    assert.equal(failed?.retryCount, 1);
    assert.equal(failed?.nextRetryAt, "2026-07-08T00:02:00.000Z");
  });
});

describe("FDC voting round and finalization helpers", () => {
  test("calculates static fallback round ids from isolated Coston2 timing", () => {
    assert.equal(
      calculateVotingRoundIdFromTiming(
        coston2StaticVotingRoundTiming.firstVotingRoundStartTimestamp + 180n,
      ),
      2n,
    );
  });

  test("checks Relay finalization before falling back to conservative timing", async () => {
    const finalizedClient: FdcReadContractClient = {
      async readContract(parameters) {
        assert.equal(parameters.functionName, "isFinalized");
        assert.deepEqual(parameters.args, [fdcProtocolId, 123n]);
        return true;
      },
    };

    assert.deepEqual(
      await checkFdcVotingRoundFinalization({
        publicClient: finalizedClient,
        relayAddress: coston2RelayAddress,
        votingRoundId: 123n,
        currentUnixTimestamp: 1_758_000_000n,
      }),
      {
        isFinalized: true,
        source: "relay",
        checkedAtUnixTimestamp: 1_758_000_000n,
        lastError: null,
      },
    );

    const fallback = await checkFdcVotingRoundFinalization({
      publicClient: {
        async readContract() {
          throw new Error("relay unavailable");
        },
      },
      relayAddress: coston2RelayAddress,
      votingRoundId: 1n,
      currentUnixTimestamp:
        coston2StaticVotingRoundTiming.firstVotingRoundStartTimestamp +
        2n * coston2StaticVotingRoundTiming.votingEpochDurationSeconds +
        180n,
    });

    assert.equal(fallback.isFinalized, true);
    assert.equal(fallback.source, "static-delay");
    assert.equal(fallback.lastError, "relay unavailable");
  });

  test("polls finalization until Relay reports the round finalized", async () => {
    const sleeps: number[] = [];
    const reads = [false, true];
    const status = await waitForFdcVotingRoundFinalization({
      publicClient: {
        async readContract() {
          return reads.shift() ?? true;
        },
      },
      relayAddress: coston2RelayAddress,
      votingRoundId: 123n,
      maxPolls: 2,
      pollIntervalMs: 25,
      nowUnixTimestamp: () => 1_758_000_000n,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    assert.equal(status.isFinalized, true);
    assert.deepEqual(sleeps, [25]);
  });
});

test(
  "live Coston2 FDC submit smoke is gated by env",
  {
    skip:
      process.env.HARBOR_COSTON2_FDC_SUBMIT_SMOKE === "1" &&
      process.env.KEEPER_PRIVATE_KEY !== undefined &&
      process.env.HARBOR_FDC_SMOKE_REQUEST_BYTES !== undefined
        ? false
        : "set HARBOR_COSTON2_FDC_SUBMIT_SMOKE=1, KEEPER_PRIVATE_KEY, and HARBOR_FDC_SMOKE_REQUEST_BYTES to run",
  },
  async () => {
    const chain = coston2Chain as unknown as Chain;
    const transport = http(
      process.env.RPC_URL_COSTON2 ?? coston2Chain.rpcUrls.default.http[0],
    );
    const account = privateKeyToAccount(
      process.env.KEEPER_PRIVATE_KEY as HexString,
    );
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });

    const submission = await submitFdcAttestationRequest({
      publicClient,
      walletClient,
      requestBytes: process.env.HARBOR_FDC_SMOKE_REQUEST_BYTES as HexString,
      account: account.address as EvmAddress,
    });

    assert.ok(submission.transactionHash.startsWith("0x"));
    assert.ok(submission.votingRoundId >= 0n);
  },
);
