import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EnvValidationError,
  normalizeBytes32,
  normalizeEvmAddress,
  normalizeRequestId,
  normalizeTransactionHash,
  parseSerializedBigint,
  redemptionStatusTransitions,
  redemptionStatuses,
  serializeBigint,
  serializeBigints,
  terminalRedemptionStatuses,
  validateBackendEnv,
  validateFrontendEnv,
} from "./index.js";

const validAddress = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD";
const normalizedValidAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const validPrivateKey = `0x${"A".repeat(64)}`;

const captureEnvError = (fn: () => unknown): EnvValidationError => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof EnvValidationError);
    return error;
  }

  assert.fail("expected env validation to fail");
};

describe("redemption status data definitions", () => {
  test("defines the MVP status vocabulary", () => {
    assert.deepEqual(redemptionStatuses, [
      "REQUESTED",
      "WATCHING",
      "SETTLED",
      "WINDOW_EXPIRED",
      "REQUEST_PROOF",
      "PROOF_READY",
      "DEFAULT_SUBMITTED",
      "RECOVERED",
      "FAILED",
      "UNKNOWN",
    ]);
  });

  test("defines transitions for every status", () => {
    assert.deepEqual(
      Object.keys(redemptionStatusTransitions).sort(),
      [...redemptionStatuses].sort(),
    );
  });

  test("marks settled, recovered, and failed as terminal", () => {
    for (const status of terminalRedemptionStatuses) {
      assert.deepEqual(redemptionStatusTransitions[status], []);
    }
  });

  test("keeps unknown as an observation-only fallback", () => {
    assert.deepEqual(
      redemptionStatusTransitions.UNKNOWN,
      redemptionStatuses.filter((status) => status !== "UNKNOWN"),
    );

    for (const status of redemptionStatuses.filter(
      (knownStatus) => knownStatus !== "UNKNOWN",
    )) {
      const nextStatuses: readonly string[] =
        redemptionStatusTransitions[status];
      assert.equal(nextStatuses.includes("UNKNOWN"), false);
    }
  });
});

describe("bigint JSON serialization", () => {
  test("serializes and parses individual bigint values", () => {
    assert.equal(
      serializeBigint(12345678901234567890n),
      "12345678901234567890",
    );
    assert.equal(
      parseSerializedBigint("12345678901234567890"),
      12345678901234567890n,
    );
    assert.equal(parseSerializedBigint("-42"), -42n);
  });

  test("serializes nested data into JSON-safe values", () => {
    const serialized = serializeBigints({
      valueUBA: 10_000_000n,
      feeUBA: 100n,
      proofs: [{ votingRoundId: 55n }],
      status: "REQUESTED",
    });

    assert.deepEqual(serialized, {
      valueUBA: "10000000",
      feeUBA: "100",
      proofs: [{ votingRoundId: "55" }],
      status: "REQUESTED",
    });
    assert.equal(
      JSON.stringify(serialized),
      '{"valueUBA":"10000000","feeUBA":"100","proofs":[{"votingRoundId":"55"}],"status":"REQUESTED"}',
    );
  });

  test("rejects malformed bigint strings", () => {
    assert.throws(() => parseSerializedBigint("1.2"));
    assert.throws(() => parseSerializedBigint("001"));
    assert.throws(() => parseSerializedBigint(""));
  });
});

describe("environment validation", () => {
  test("validates and normalizes backend env", () => {
    const env = validateBackendEnv({
      RPC_URL_COSTON2: "https://coston2-api.flare.network/ext/C/rpc",
      INDEXER_DB_URL: "postgresql://harbor:harbor@localhost:5432/harbor",
      XRPL_ENDPOINT: "wss://s.altnet.rippletest.net:51233",
      FDC_DA_LAYER_URL: "https://fdc-da-layer.example",
      RPC_API_KEY_COSTON2: " flare-key ",
      XRPL_API_KEY: "",
      FDC_DA_LAYER_API_KEY: "fdc-key",
      KEEPER_PRIVATE_KEY: validPrivateKey,
      HARBOR_REDEEMER_ADDRESS: validAddress,
    });

    assert.equal(
      env.rpcUrlCoston2,
      "https://coston2-api.flare.network/ext/C/rpc",
    );
    assert.equal(
      env.indexerDbUrl,
      "postgresql://harbor:harbor@localhost:5432/harbor",
    );
    assert.equal(env.xrplEndpoint, "wss://s.altnet.rippletest.net:51233");
    assert.equal(env.fdcDaLayerUrl, "https://fdc-da-layer.example");
    assert.equal(env.rpcApiKeyCoston2, "flare-key");
    assert.equal("xrplApiKey" in env, false);
    assert.equal(env.fdcDaLayerApiKey, "fdc-key");
    assert.equal(env.keeperPrivateKey, `0x${"a".repeat(64)}`);
    assert.equal(env.harborRedeemerAddress, normalizedValidAddress);
  });

  test("reports backend env failures together", () => {
    const error = captureEnvError(() =>
      validateBackendEnv({
        RPC_URL_COSTON2: "ftp://rpc.example",
        INDEXER_DB_URL: "not-a-url",
        XRPL_ENDPOINT: "",
        FDC_DA_LAYER_URL: "https://fdc-da-layer.example",
        KEEPER_PRIVATE_KEY: "0x123",
        HARBOR_REDEEMER_ADDRESS: "0x123",
      }),
    );

    assert.deepEqual(
      error.issues.map((issue) => issue.name),
      [
        "RPC_URL_COSTON2",
        "INDEXER_DB_URL",
        "XRPL_ENDPOINT",
        "KEEPER_PRIVATE_KEY",
        "HARBOR_REDEEMER_ADDRESS",
      ],
    );
  });

  test("validates and normalizes frontend env", () => {
    const env = validateFrontendEnv({
      NEXT_PUBLIC_RPC_URL_COSTON2: "https://rpc.example",
      NEXT_PUBLIC_HARBOR_API_URL: "https://api.example",
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "walletconnect-project",
      NEXT_PUBLIC_HARBOR_CONTRACT_ADDRESS: validAddress,
    });

    assert.equal(env.publicRpcUrlCoston2, "https://rpc.example");
    assert.equal(env.publicHarborApiUrl, "https://api.example");
    assert.equal(env.walletConnectProjectId, "walletconnect-project");
    assert.equal(env.harborContractAddress, normalizedValidAddress);
  });

  test("reports frontend env failures together", () => {
    const error = captureEnvError(() =>
      validateFrontendEnv({
        NEXT_PUBLIC_RPC_URL_COSTON2: "https://rpc.example",
        NEXT_PUBLIC_HARBOR_API_URL: "not-a-url",
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "",
        NEXT_PUBLIC_HARBOR_CONTRACT_ADDRESS: "0x123",
      }),
    );

    assert.deepEqual(
      error.issues.map((issue) => issue.name),
      [
        "NEXT_PUBLIC_HARBOR_API_URL",
        "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
        "NEXT_PUBLIC_HARBOR_CONTRACT_ADDRESS",
      ],
    );
  });
});

describe("normalization helpers", () => {
  test("normalizes EVM addresses", () => {
    assert.equal(
      normalizeEvmAddress(` ${validAddress} `),
      normalizedValidAddress,
    );
    assert.throws(() => normalizeEvmAddress("0x123"));
    assert.throws(() => normalizeEvmAddress("not-an-address"));
  });

  test("normalizes request ids", () => {
    assert.equal(normalizeRequestId("00042"), "42");
    assert.equal(normalizeRequestId(7), "7");
    assert.equal(normalizeRequestId(9007199254740993n), "9007199254740993");
    assert.throws(() => normalizeRequestId(-1n));
    assert.throws(() => normalizeRequestId(9007199254740993));
    assert.throws(() => normalizeRequestId("12.5"));
  });

  test("normalizes bytes32 and transaction hashes", () => {
    assert.equal(
      normalizeBytes32(`0X${"AA".repeat(32)}`),
      `0x${"aa".repeat(32)}`,
    );
    assert.equal(
      normalizeTransactionHash("BB".repeat(32)),
      `0x${"bb".repeat(32)}`,
    );
    assert.throws(() => normalizeBytes32("0x123"));
    assert.throws(() => normalizeTransactionHash("not-a-hash"));
  });
});
