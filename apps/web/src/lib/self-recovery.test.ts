import type { SerializedFdcProofRecord } from "@harbor/shared";
import { describe, expect, it } from "vitest";

import {
  buildDefaultExecutionArgs,
  buildExecuteDefaultArgs,
  buildExecuteXrpDefaultArgs,
  decodeProofResponseBody,
  decodeXrpProofResponseBody,
  isBytes32,
  parseRedemptionRequestId,
  resolveHarborRedeemerAddress,
  resolveSelfRecoveryPhase,
  validateMerkleProof,
  validateXrpResponseData,
  type SelfRecoveryPhaseInput,
} from "@/lib/self-recovery";
import {
  encodeSampleProofResponseBody,
  encodeSampleXrpProofResponseBody,
  makeXrpFdcProof,
  proofReadyResponse,
  sampleXrpProofResponseData,
} from "@/test/redemption-status-fixtures";

const REQUEST_ID = "4207";

/** A valid backend proof record with a real ABI-encoded responseBody. */
function validProofRecord(): SerializedFdcProofRecord {
  const record = proofReadyResponse({
    requestId: REQUEST_ID,
    validProof: true,
  }).fdcProofs[0];
  if (record === undefined) {
    throw new Error("fixture must include a proof");
  }
  return record;
}

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------

describe("isBytes32", () => {
  it("accepts a 0x-prefixed 32-byte hex string", () => {
    expect(isBytes32(`0x${"ab".repeat(32)}`)).toBe(true);
  });

  it("rejects wrong lengths, non-hex, and non-strings", () => {
    expect(isBytes32(`0x${"ab".repeat(31)}`)).toBe(false);
    expect(isBytes32("0xnothex")).toBe(false);
    expect(isBytes32("feed")).toBe(false);
    expect(isBytes32(123)).toBe(false);
    expect(isBytes32(null)).toBe(false);
  });
});

describe("parseRedemptionRequestId", () => {
  it("parses non-negative integer strings", () => {
    expect(parseRedemptionRequestId("4207")).toBe(4207n);
    expect(parseRedemptionRequestId("0")).toBe(0n);
    expect(parseRedemptionRequestId("  12  ")).toBe(12n);
  });

  it("rejects negatives, decimals, and non-numeric input", () => {
    expect(parseRedemptionRequestId("-1")).toBeNull();
    expect(parseRedemptionRequestId("1.5")).toBeNull();
    expect(parseRedemptionRequestId("0x10")).toBeNull();
    expect(parseRedemptionRequestId("abc")).toBeNull();
    expect(parseRedemptionRequestId("")).toBeNull();
  });
});

describe("validateMerkleProof", () => {
  it("accepts an array of bytes32 entries", () => {
    expect(
      validateMerkleProof([`0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`]),
    ).toEqual([]);
    // An empty merkle proof is a valid shape (single-leaf trees).
    expect(validateMerkleProof([])).toEqual([]);
  });

  it("flags a non-array", () => {
    expect(validateMerkleProof("nope")).toContain(
      "merkleProof must be an array",
    );
  });

  it("flags a non-bytes32 entry with its index", () => {
    const issues = validateMerkleProof([`0x${"11".repeat(32)}`, "0xdead"]);
    expect(issues).toContain("merkleProof[1] must be bytes32");
  });
});

describe("resolveHarborRedeemerAddress", () => {
  it("returns a checksummed address for a valid input", () => {
    const raw = "0xc1ca88b937d0b528842f95d5731ffb586f4fbdfa";
    expect(resolveHarborRedeemerAddress(raw)).toBe(
      "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA",
    );
  });

  it("returns null for null/invalid input", () => {
    expect(resolveHarborRedeemerAddress(null)).toBeNull();
    expect(resolveHarborRedeemerAddress(undefined)).toBeNull();
    expect(resolveHarborRedeemerAddress("not-an-address")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Response decoding
// ---------------------------------------------------------------------------

describe("decodeProofResponseBody", () => {
  it("decodes a valid encoded Response tuple into typed fields", () => {
    const result = decodeProofResponseBody(encodeSampleProofResponseBody());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.votingRound).toBe(12345n);
    expect(result.data.lowestUsedTimestamp).toBe(1700000000n);
    expect(result.data.requestBody.amount).toBe(10000000n);
    expect(result.data.requestBody.checkSourceAddresses).toBe(false);
    expect(isBytes32(result.data.requestBody.destinationAddressHash)).toBe(
      true,
    );
    expect(result.data.responseBody.firstOverflowBlockNumber).toBe(250n);
  });

  it("rejects the inert placeholder and malformed hex", () => {
    expect(decodeProofResponseBody("0xfeed").ok).toBe(false);
    expect(decodeProofResponseBody("not-hex").ok).toBe(false);
    expect(decodeProofResponseBody("").ok).toBe(false);
    expect(decodeProofResponseBody(42).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executeDefault calldata assembly + validation
// ---------------------------------------------------------------------------

describe("buildExecuteDefaultArgs", () => {
  it("builds validated [proof, requestId] args from a valid proof record", () => {
    const result = buildExecuteDefaultArgs(validProofRecord(), REQUEST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const [proof, requestId] = result.args;
    expect(requestId).toBe(4207n);
    // merkleProof is passed through verbatim from the backend record.
    expect(proof.merkleProof).toEqual([
      `0x${"44".repeat(32)}`,
      `0x${"55".repeat(32)}`,
    ]);
    // data is the decoded Response tuple.
    expect(proof.data.votingRound).toBe(12345n);
    expect(proof.data.requestBody.amount).toBe(10000000n);
  });

  it("fails when no proof is available", () => {
    const result = buildExecuteDefaultArgs(null, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.join(" ")).toMatch(/no fdc proof/i);
  });

  it("fails when the responseBody is not a valid encoded Response", () => {
    const record = { ...validProofRecord(), responseBody: "0xfeed" as const };
    const result = buildExecuteDefaultArgs(record, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.join(" ")).toMatch(/response/i);
  });

  it("fails when a merkleProof entry is not bytes32", () => {
    const record = {
      ...validProofRecord(),
      merkleProof: ["0xdead"] as unknown as readonly `0x${string}`[],
    };
    const result = buildExecuteDefaultArgs(record, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.join(" ")).toMatch(/merkleproof/i);
  });

  it("fails when the request id is not a non-negative integer", () => {
    const result = buildExecuteDefaultArgs(validProofRecord(), "0x10");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.join(" ")).toMatch(/redemptionRequestId/i);
  });
});

// ---------------------------------------------------------------------------
// Panel state machine
// ---------------------------------------------------------------------------

const baseInput: SelfRecoveryPhaseInput = {
  visible: true,
  recovered: false,
  defaultSubmitted: false,
  proofAvailable: true,
  proofValid: true,
  contractConfigured: true,
  walletConnected: true,
  correctNetwork: true,
  localTx: "idle",
};

function phase(overrides: Partial<SelfRecoveryPhaseInput>) {
  return resolveSelfRecoveryPhase({ ...baseInput, ...overrides });
}

describe("resolveSelfRecoveryPhase", () => {
  it("ready when proof is valid, wallet connected, and on the right network", () => {
    expect(phase({})).toBe("ready");
  });

  it("hidden when not on the recovery track", () => {
    expect(phase({ visible: false })).toBe("hidden");
  });

  it("proof-not-ready when no proof is available yet", () => {
    expect(phase({ proofAvailable: false })).toBe("proof-not-ready");
  });

  it("proof-invalid when the proof cannot be validated", () => {
    expect(phase({ proofValid: false })).toBe("proof-invalid");
  });

  it("contract-unconfigured when no HarborRedeemer address is set", () => {
    expect(phase({ contractConfigured: false })).toBe("contract-unconfigured");
  });

  it("wallet-required when no wallet is connected", () => {
    expect(phase({ walletConnected: false })).toBe("wallet-required");
  });

  it("wrong-network when the wallet is on another chain", () => {
    expect(phase({ correctNetwork: false })).toBe("wrong-network");
  });

  it("submitting while the local transaction is in flight", () => {
    expect(phase({ localTx: "submitting" })).toBe("submitting");
  });

  it("submitted after the local transaction confirms", () => {
    expect(phase({ localTx: "submitted" })).toBe("submitted");
  });

  it("submitted when the backend already shows a default (keeper/third party)", () => {
    expect(phase({ defaultSubmitted: true })).toBe("submitted");
  });

  it("recovered takes precedence over every other state", () => {
    expect(phase({ recovered: true, defaultSubmitted: true })).toBe(
      "recovered",
    );
  });

  it("is front-run-safe: an external default while we submit resolves to submitted", () => {
    // Someone else lands the same proof while our tx is in flight.
    expect(phase({ localTx: "submitting", defaultSubmitted: true })).toBe(
      "submitted",
    );
  });

  it("stays actionable regardless of keeper health (no health input exists)", () => {
    // The input type has no keeper/health field; a ready proof is always ready.
    expect(phase({})).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// redeem-by-tag: executeXrpDefault arg assembly + kind routing
// ---------------------------------------------------------------------------

describe("buildExecuteXrpDefaultArgs", () => {
  it("builds executeXrpDefault args from a valid XRP proof", () => {
    const proof = makeXrpFdcProof(REQUEST_ID, true);
    const result = buildExecuteXrpDefaultArgs(proof, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args[1]).toBe(BigInt(REQUEST_ID));
      expect(result.args[0].data.requestBody.destinationTag).toBe(12345n);
      expect(result.args[0].data.requestBody.checkDestinationTag).toBe(true);
    }
  });

  it("rejects an invalid XRP proof responseBody", () => {
    const proof = makeXrpFdcProof(REQUEST_ID, false);
    const result = buildExecuteXrpDefaultArgs(proof, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects a missing proof", () => {
    const result = buildExecuteXrpDefaultArgs(null, REQUEST_ID);
    expect(result.ok).toBe(false);
  });
});

describe("buildDefaultExecutionArgs (kind routing)", () => {
  it("routes a WITH_TAG redemption to executeXrpDefault", () => {
    const proof = makeXrpFdcProof(REQUEST_ID, true);
    const target = buildDefaultExecutionArgs(proof, REQUEST_ID, "WITH_TAG");
    expect(target.ok).toBe(true);
    if (target.ok) {
      expect(target.functionName).toBe("executeXrpDefault");
    }
  });

  it("routes a STANDARD redemption to executeDefault", () => {
    const target = buildDefaultExecutionArgs(
      validProofRecord(),
      REQUEST_ID,
      "STANDARD",
    );
    expect(target.ok).toBe(true);
    if (target.ok) {
      expect(target.functionName).toBe("executeDefault");
    }
  });

  it("a STANDARD redemption with an XRP-shaped proof is rejected (kind gates the lane, proof must match)", () => {
    // The kind selects the entrypoint AND the proof decoder. An XRP proof
    // against a STANDARD redemption cannot be decoded as an RPNE Response, so
    // the UI rejects it (proof-invalid) rather than silently routing to the
    // wrong default. A kind/proof mismatch is caught here, never on-chain.
    const target = buildDefaultExecutionArgs(
      makeXrpFdcProof(REQUEST_ID, true),
      REQUEST_ID,
      "STANDARD",
    );
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.issues.length).toBeGreaterThan(0);
    }
  });

  it("a WITH_TAG redemption with no proof is rejected with a 'no FDC proof' issue", () => {
    const target = buildDefaultExecutionArgs(null, REQUEST_ID, "WITH_TAG");
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.issues.join(" ")).toMatch(/no fdc proof/i);
    }
  });

  it("a WITH_TAG redemption with a malformed XRP proof is rejected with a decode issue", () => {
    // A present-but-undecodable XRP proof must fail with a concrete, non-empty
    // reason (distinguishing "unusable proof" from "no proof yet"), and must
    // never fall through to the STANDARD lane.
    const target = buildDefaultExecutionArgs(
      makeXrpFdcProof(REQUEST_ID, false),
      REQUEST_ID,
      "WITH_TAG",
    );
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.issues.length).toBeGreaterThan(0);
      expect(target.issues.join(" ")).toMatch(/response/i);
      // Not the "no proof yet" message: the proof exists, it is just unusable.
      expect(target.issues.join(" ")).not.toMatch(/no fdc proof/i);
    }
  });

  it("a WITH_TAG redemption with a valid XRP proof but a bad request id is rejected", () => {
    const target = buildDefaultExecutionArgs(
      makeXrpFdcProof(REQUEST_ID, true),
      "0x10",
      "WITH_TAG",
    );
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.issues.join(" ")).toMatch(/redemptionRequestId/i);
    }
  });
});

// ---------------------------------------------------------------------------
// redeem-by-tag: XRP Response decoding + validation (executeXrpDefault lane)
// ---------------------------------------------------------------------------

describe("decodeXrpProofResponseBody", () => {
  it("decodes a valid encoded XRP Response tuple into typed fields", () => {
    const result = decodeXrpProofResponseBody(
      encodeSampleXrpProofResponseBody(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.votingRound).toBe(12345n);
    expect(result.data.lowestUsedTimestamp).toBe(1700000000n);
    expect(result.data.requestBody.amount).toBe(9990000n);
    // The tag lane always sets both check flags and a (zero) proofOwner.
    expect(result.data.requestBody.checkDestinationTag).toBe(true);
    expect(result.data.requestBody.checkFirstMemoData).toBe(true);
    expect(result.data.requestBody.destinationTag).toBe(12345n);
    expect(isBytes32(result.data.requestBody.firstMemoDataHash)).toBe(true);
    expect(result.data.responseBody.firstOverflowBlockNumber).toBe(250n);
  });

  it("rejects non-hex, empty, and non-string responseBody as 'not a hex string'", () => {
    for (const bad of ["not-hex", "", 42, null, undefined, {}]) {
      const result = decodeXrpProofResponseBody(bad as unknown);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issue).toMatch(/not a hex string/i);
      }
    }
  });

  it("rejects valid hex that is not a decodable XRP Response tuple", () => {
    const result = decodeXrpProofResponseBody("0xfeed");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue).toMatch(/valid encoded xrp/i);
    }
  });

  it("rejects a standard (non-XRP) Response tuple decoded on the XRP lane", () => {
    // A standard RPNE Response has fewer requestBody fields than the XRP one,
    // so decoding it as an XRP tuple must not silently succeed. Depending on
    // ABI layout it either fails to decode or fails field validation; either
    // way the result is a rejection, never an accepted XRP proof.
    const result = decodeXrpProofResponseBody(encodeSampleProofResponseBody());
    expect(result.ok).toBe(false);
  });
});

/**
 * A fresh, mutable, structurally valid decoded XRP `Response` object (plain
 * bigints/hex/booleans), mirroring `sampleXrpProofResponseData`. Returned as a
 * mutable record so each negative test can corrupt exactly one field.
 */
function makeValidXrpData(): Record<string, unknown> {
  return {
    attestationType: `0x${"09".repeat(32)}`,
    sourceId: `0x${"22".repeat(32)}`,
    votingRound: 12345n,
    lowestUsedTimestamp: 1700000000n,
    requestBody: {
      minimalBlockNumber: 100n,
      deadlineBlockNumber: 200n,
      deadlineTimestamp: 1700000500n,
      destinationAddressHash: `0x${"33".repeat(32)}`,
      amount: 9990000n,
      checkFirstMemoData: true,
      firstMemoDataHash: `0x${"44".repeat(32)}`,
      checkDestinationTag: true,
      destinationTag: 12345n,
      proofOwner: `0x${"00".repeat(20)}`,
    },
    responseBody: {
      minimalBlockTimestamp: 1699999000n,
      firstOverflowBlockNumber: 250n,
      firstOverflowBlockTimestamp: 1700000600n,
    },
  };
}

describe("validateXrpResponseData", () => {
  it("returns no issues for a fully valid decoded XRP Response", () => {
    expect(validateXrpResponseData(makeValidXrpData())).toEqual([]);
    // The canonical fixture data must also validate clean (guards drift between
    // the fixture and the local factory).
    expect(validateXrpResponseData(sampleXrpProofResponseData())).toEqual([]);
  });

  it("flags a non-object as 'not an object'", () => {
    for (const bad of [null, undefined, 42, "x", true]) {
      expect(validateXrpResponseData(bad as unknown)).toEqual([
        "XRP Response data is not an object",
      ]);
    }
  });

  it("flags each invalid top-level field with its own issue", () => {
    const cases: ReadonlyArray<readonly [string, unknown, RegExp]> = [
      ["attestationType", "0xnotbytes32", /attestationType must be bytes32/],
      ["sourceId", 123, /sourceId must be bytes32/],
      ["votingRound", -1n, /votingRound must be a non-negative integer/],
      [
        "lowestUsedTimestamp",
        "1700000000",
        /lowestUsedTimestamp must be a non-negative integer/,
      ],
    ];
    for (const [field, badValue, pattern] of cases) {
      const data = makeValidXrpData();
      data[field] = badValue;
      const issues = validateXrpResponseData(data);
      expect(issues.some((issue) => pattern.test(issue))).toBe(true);
    }
  });

  it("flags a missing requestBody sub-struct", () => {
    const data = makeValidXrpData();
    delete data["requestBody"];
    expect(validateXrpResponseData(data)).toContain("requestBody is missing");
  });

  it("flags each invalid requestBody numeric field, including destinationTag", () => {
    for (const field of [
      "minimalBlockNumber",
      "deadlineBlockNumber",
      "deadlineTimestamp",
      "amount",
      "destinationTag",
    ] as const) {
      const data = makeValidXrpData();
      (data["requestBody"] as Record<string, unknown>)[field] = -5n;
      const issues = validateXrpResponseData(data);
      expect(issues).toContain(
        `requestBody.${field} must be a non-negative integer`,
      );
    }
  });

  it("flags invalid requestBody bytes32 fields and boolean flags", () => {
    const hashFields = ["destinationAddressHash", "firstMemoDataHash"] as const;
    for (const field of hashFields) {
      const data = makeValidXrpData();
      (data["requestBody"] as Record<string, unknown>)[field] = "0xshort";
      expect(validateXrpResponseData(data)).toContain(
        `requestBody.${field} must be bytes32`,
      );
    }
    for (const field of [
      "checkFirstMemoData",
      "checkDestinationTag",
    ] as const) {
      const data = makeValidXrpData();
      (data["requestBody"] as Record<string, unknown>)[field] = "true";
      expect(validateXrpResponseData(data)).toContain(
        `requestBody.${field} must be a boolean`,
      );
    }
  });

  it("flags a proofOwner that is not an EVM address", () => {
    const data = makeValidXrpData();
    (data["requestBody"] as Record<string, unknown>)["proofOwner"] =
      "0xnotanaddress";
    expect(validateXrpResponseData(data)).toContain(
      "requestBody.proofOwner must be an address",
    );
  });

  it("flags a missing responseBody sub-struct and invalid inner fields", () => {
    const missing = makeValidXrpData();
    delete missing["responseBody"];
    expect(validateXrpResponseData(missing)).toContain(
      "responseBody sub-struct is missing",
    );

    for (const field of [
      "minimalBlockTimestamp",
      "firstOverflowBlockNumber",
      "firstOverflowBlockTimestamp",
    ] as const) {
      const data = makeValidXrpData();
      (data["responseBody"] as Record<string, unknown>)[field] = -1n;
      expect(validateXrpResponseData(data)).toContain(
        `responseBody.${field} must be a non-negative integer`,
      );
    }
  });

  it("property: every structurally valid XRP Response variant validates clean", () => {
    // A deterministic sweep across the full uint32 tag range, both check-flag
    // combinations, and a wide spread of amounts/blocks/timestamps. For any
    // valid data the validator must return an empty issue list.
    const tags = [0n, 1n, 255n, 65535n, 4294967295n, 777n];
    const amounts = [0n, 1n, 9990000n, 10n ** 18n];
    const blocks = [0n, 1n, 100n, 2n ** 40n];
    for (const tag of tags) {
      for (const amount of amounts) {
        for (const block of blocks) {
          for (const checkTag of [true, false]) {
            for (const checkMemo of [true, false]) {
              const data = makeValidXrpData();
              const rb = data["requestBody"] as Record<string, unknown>;
              rb["destinationTag"] = tag;
              rb["amount"] = amount;
              rb["minimalBlockNumber"] = block;
              rb["deadlineBlockNumber"] = block;
              rb["checkDestinationTag"] = checkTag;
              rb["checkFirstMemoData"] = checkMemo;
              expect(validateXrpResponseData(data)).toEqual([]);
            }
          }
        }
      }
    }
  });
});
