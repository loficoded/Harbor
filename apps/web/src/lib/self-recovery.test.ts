import type { SerializedFdcProofRecord } from "@harbor/shared";
import { describe, expect, it } from "vitest";

import {
  buildDefaultExecutionArgs,
  buildExecuteDefaultArgs,
  buildExecuteXrpDefaultArgs,
  decodeProofResponseBody,
  isBytes32,
  parseRedemptionRequestId,
  resolveHarborRedeemerAddress,
  resolveSelfRecoveryPhase,
  validateMerkleProof,
  type SelfRecoveryPhaseInput,
} from "@/lib/self-recovery";
import {
  encodeSampleProofResponseBody,
  makeXrpFdcProof,
  proofReadyResponse,
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
});
