import { destinationTagMax } from "@harbor/shared";
import {
  buildRedeemCallArgs,
  buildStatusPath,
  FXRP_DECIMALS,
  formatFxrpAmount,
  hasSufficientBalance,
  isApprovalRequired,
  parseDestinationTag,
  parseRedeemAmount,
  parseRedemptionRequestIds,
  redemptionBlockedReason,
  resolveExecutor,
  type RedemptionReadiness,
} from "@/lib/redemption";
import {
  NOISE_LOG,
  redemptionRequestedLog,
  redemptionWithTagRequestedLog,
} from "@/test/redemption-fixtures";
import { getAddress, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

// --- arbitrary amount (primary flow) ---------------------------------------

describe("parseRedeemAmount", () => {
  it("treats an empty field as incomplete, not an error", () => {
    expect(parseRedeemAmount("")).toEqual({ amountUba: null, error: null });
    expect(parseRedeemAmount("   ")).toEqual({ amountUba: null, error: null });
  });

  it("parses whole and decimal amounts into exact UBA (6 decimals)", () => {
    expect(FXRP_DECIMALS).toBe(6);
    expect(parseRedeemAmount("1")).toEqual({
      amountUba: 1_000_000n,
      error: null,
    });
    expect(parseRedeemAmount("2.37")).toEqual({
      amountUba: 2_370_000n,
      error: null,
    });
    // Leading and trailing dot forms are accepted and normalized.
    expect(parseRedeemAmount(".5").amountUba).toBe(500_000n);
    expect(parseRedeemAmount("10.").amountUba).toBe(10_000_000n);
    // The smallest representable unit (1 drop).
    expect(parseRedeemAmount("0.000001").amountUba).toBe(1n);
  });

  it("uses exact bigint math (no floating point) for large amounts", () => {
    expect(parseRedeemAmount("1000000").amountUba).toBe(1_000_000_000_000n);
    // 9007199254.740993 exceeds Number.MAX_SAFE_INTEGER when scaled; must stay exact.
    expect(parseRedeemAmount("9007199254.740993").amountUba).toBe(
      9_007_199_254_740_993n,
    );
  });

  it("rejects zero and non-positive amounts", () => {
    expect(parseRedeemAmount("0").amountUba).toBeNull();
    expect(parseRedeemAmount("0").error).toMatch(/greater than zero/i);
    expect(parseRedeemAmount("0.0").error).toMatch(/greater than zero/i);
    expect(parseRedeemAmount("0.000000").error).toMatch(/greater than zero/i);
  });

  it("rejects negative, non-numeric, and malformed input", () => {
    expect(parseRedeemAmount("-1").error).toMatch(/valid fxrp amount/i);
    expect(parseRedeemAmount("abc").error).toMatch(/valid fxrp amount/i);
    expect(parseRedeemAmount("1.2.3").error).toMatch(/valid fxrp amount/i);
    expect(parseRedeemAmount(".").error).toMatch(/valid fxrp amount/i);
    expect(parseRedeemAmount("1e3").error).toMatch(/valid fxrp amount/i);
  });

  it("rejects more fractional digits than the asset supports", () => {
    // 7 decimals for a 6-decimal asset.
    const result = parseRedeemAmount("1.1234567");
    expect(result.amountUba).toBeNull();
    expect(result.error).toMatch(/up to 6 decimal places/i);
  });

  it("respects a custom decimal count", () => {
    expect(parseRedeemAmount("1.23", 2).amountUba).toBe(123n);
    expect(parseRedeemAmount("1.234", 2).error).toMatch(/2 decimal places/i);
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseRedeemAmount("  2.5  ").amountUba).toBe(2_500_000n);
    expect(parseRedeemAmount("\t1\n").amountUba).toBe(1_000_000n);
  });

  it("normalizes leading zeros and trailing fractional zeros", () => {
    expect(parseRedeemAmount("007").amountUba).toBe(7_000_000n);
    expect(parseRedeemAmount("00.50").amountUba).toBe(500_000n);
    // Exactly `decimals` fractional digits is the boundary and must be accepted.
    expect(parseRedeemAmount("1.230000").amountUba).toBe(1_230_000n);
  });

  it("accepts the maximum-precision fractional boundary but rejects one more", () => {
    // 6 fractional digits is allowed; a 7th is rejected.
    expect(parseRedeemAmount("0.123456").amountUba).toBe(123_456n);
    expect(parseRedeemAmount("0.1234560").error).toMatch(
      /up to 6 decimal places/i,
    );
  });

  it("does not use floating point for values that lose precision as Number", () => {
    // 0.1 + 0.2 style drift must never appear: parse each exactly.
    expect(parseRedeemAmount("0.1").amountUba).toBe(100_000n);
    expect(parseRedeemAmount("0.2").amountUba).toBe(200_000n);
    // A 30-digit whole amount stays exact (far beyond Number.MAX_SAFE_INTEGER).
    expect(parseRedeemAmount("123456789012345678901234567890").amountUba).toBe(
      123456789012345678901234567890n * 10n ** 6n,
    );
  });

  it("rejects thousands separators, signs, and exponents", () => {
    expect(parseRedeemAmount("1,000").error).toMatch(/valid fxrp amount/i);
    expect(parseRedeemAmount("+1").error).toMatch(/valid fxrp amount/i);
    expect(parseRedeemAmount("1e-3").error).toMatch(/valid fxrp amount/i);
  });
});

// --- amount formatting ------------------------------------------------------

describe("formatFxrpAmount", () => {
  it("formats whole and fractional UBA amounts (6 decimals)", () => {
    expect(formatFxrpAmount(30_000_000n)).toBe("30");
    expect(formatFxrpAmount(10_000_000n)).toBe("10");
    expect(formatFxrpAmount(2_370_000n)).toBe("2.37");
    // Smallest representable unit (1 drop) formats without loss.
    expect(formatFxrpAmount(1n)).toBe("0.000001");
    expect(formatFxrpAmount(0n)).toBe("0");
  });

  it("round-trips parse -> format -> parse to a stable UBA value", () => {
    for (const input of ["1", "2.37", "0.000001", "1000000", "0.5", "10"]) {
      const { amountUba } = parseRedeemAmount(input);
      expect(amountUba).not.toBeNull();
      // Formatting then re-parsing must yield the identical UBA amount.
      const reparsed = parseRedeemAmount(formatFxrpAmount(amountUba as bigint));
      expect(reparsed.amountUba).toBe(amountUba);
    }
  });

  it("respects a custom decimal count", () => {
    expect(formatFxrpAmount(123n, 2)).toBe("1.23");
    expect(formatFxrpAmount(100n, 2)).toBe("1");
  });
});

// --- balance & approval -----------------------------------------------------

describe("hasSufficientBalance", () => {
  it("is false when balance is unknown or below the requirement", () => {
    expect(hasSufficientBalance(undefined, 10n)).toBe(false);
    expect(hasSufficientBalance(5n, 10n)).toBe(false);
  });

  it("is true when balance meets or exceeds the requirement", () => {
    expect(hasSufficientBalance(10n, 10n)).toBe(true);
    expect(hasSufficientBalance(20n, 10n)).toBe(true);
  });

  it("is false when nothing is required", () => {
    expect(hasSufficientBalance(20n, 0n)).toBe(false);
  });
});

describe("isApprovalRequired", () => {
  it("requires approval when allowance is unknown", () => {
    expect(isApprovalRequired(undefined, 10n)).toBe(true);
  });

  it("requires approval when allowance is below the requirement", () => {
    expect(isApprovalRequired(5n, 10n)).toBe(true);
  });

  it("does not require approval when allowance covers the requirement", () => {
    expect(isApprovalRequired(10n, 10n)).toBe(false);
    expect(isApprovalRequired(50n, 10n)).toBe(false);
  });

  it("does not require approval when nothing is required", () => {
    expect(isApprovalRequired(undefined, 0n)).toBe(false);
  });
});

// --- executor ---------------------------------------------------------------

describe("resolveExecutor", () => {
  it("returns a self-managed zero executor when no Harbor address is configured", () => {
    expect(resolveExecutor(null, 100n)).toEqual({
      executor: zeroAddress,
      executorFeeWei: 0n,
      harborManaged: false,
    });
  });

  it("treats an invalid contract address as unconfigured", () => {
    expect(resolveExecutor("not-an-address", 100n).harborManaged).toBe(false);
  });

  it("uses the Harbor executor and default fee when configured", () => {
    const resolved = resolveExecutor(
      "0x00000000000000000000000000000000000000ab",
      100n,
    );
    expect(resolved.harborManaged).toBe(true);
    expect(resolved.executorFeeWei).toBe(100n);
    // Checksummed by viem's getAddress.
    expect(resolved.executor).toBe(
      getAddress("0x00000000000000000000000000000000000000ab"),
    );
  });

  it("clamps a non-positive fee to zero", () => {
    expect(
      resolveExecutor("0x00000000000000000000000000000000000000ab", 0n)
        .executorFeeWei,
    ).toBe(0n);
  });
});

// --- receipt parsing --------------------------------------------------------

describe("parseRedemptionRequestIds", () => {
  it("returns an empty list for no logs", () => {
    expect(parseRedemptionRequestIds([])).toEqual([]);
  });

  it("extracts a single request id", () => {
    expect(parseRedemptionRequestIds([redemptionRequestedLog(4207n)])).toEqual([
      "4207",
    ]);
  });

  it("extracts multiple request ids in emission order, skipping noise", () => {
    const ids = parseRedemptionRequestIds([
      NOISE_LOG,
      redemptionRequestedLog(4207n),
      redemptionRequestedLog(4208n),
    ]);
    expect(ids).toEqual(["4207", "4208"]);
  });

  it("deduplicates repeated ids", () => {
    const log = redemptionRequestedLog(4207n);
    expect(parseRedemptionRequestIds([log, log])).toEqual(["4207"]);
  });

  it("ignores logs with no topics", () => {
    expect(parseRedemptionRequestIds([{ data: "0x", topics: [] }])).toEqual([]);
  });

  it("parses RedemptionWithTagRequested ids (tag redemptions emit this, not RedemptionRequested)", () => {
    expect(
      parseRedemptionRequestIds([redemptionWithTagRequestedLog(5100n)]),
    ).toEqual(["5100"]);
  });

  it("parses a mixed batch of standard and tag redemption logs in order", () => {
    const ids = parseRedemptionRequestIds([
      redemptionRequestedLog(1n),
      redemptionWithTagRequestedLog(2n),
      redemptionRequestedLog(3n),
    ]);
    expect(ids).toEqual(["1", "2", "3"]);
  });
});

// --- destination tag (redeem-by-tag) ---------------------------------------

describe("parseDestinationTag", () => {
  it("treats empty input as 'no tag' (not an error)", () => {
    expect(parseDestinationTag("")).toEqual({ tag: null, error: null });
    expect(parseDestinationTag("   ")).toEqual({ tag: null, error: null });
  });

  it("accepts zero as a valid tag (selects the tag path)", () => {
    expect(parseDestinationTag("0")).toEqual({ tag: 0n, error: null });
  });

  it("accepts the full uint32 range inclusive", () => {
    expect(parseDestinationTag("1")).toEqual({ tag: 1n, error: null });
    expect(parseDestinationTag("4294967295")).toEqual({
      tag: destinationTagMax,
      error: null,
    });
  });

  it("rejects values at or above 2**32", () => {
    expect(parseDestinationTag("4294967296").error).toMatch(/32 bits/);
  });

  it("rejects non-numeric and negative input", () => {
    expect(parseDestinationTag("abc").error).toMatch(/whole number/);
    expect(parseDestinationTag("-1").error).toMatch(/whole number/);
    expect(parseDestinationTag("1.5").error).toMatch(/whole number/);
  });
});

describe("buildRedeemCallArgs", () => {
  const executor = getAddress("0x00000000000000000000000000000000000000cc");

  it("routes to redeemAmount when no tag is provided", () => {
    const call = buildRedeemCallArgs({
      amountUba: 10_000_000n,
      xrplAddress: "rDestination",
      executor,
      destinationTag: null,
    });
    expect(call.functionName).toBe("redeemAmount");
    expect(call.args).toEqual([10_000_000n, "rDestination", executor]);
  });

  it("routes to redeemWithTag with the tag as the 4th arg when a tag is present", () => {
    const call = buildRedeemCallArgs({
      amountUba: 10_000_000n,
      xrplAddress: "rDestination",
      executor,
      destinationTag: 12345n,
    });
    expect(call.functionName).toBe("redeemWithTag");
    expect(call.args).toEqual([10_000_000n, "rDestination", executor, 12345n]);
  });

  it("treats tag 0 as the tag path (not standard)", () => {
    const call = buildRedeemCallArgs({
      amountUba: 5_000_000n,
      xrplAddress: "rDest",
      executor,
      destinationTag: 0n,
    });
    expect(call.functionName).toBe("redeemWithTag");
    expect(call.args[3]).toBe(0n);
  });
});

// --- routing ----------------------------------------------------------------

describe("buildStatusPath", () => {
  it("returns null when there are no request ids", () => {
    expect(buildStatusPath({ requestIds: [] })).toBeNull();
  });

  it("routes to the first id with no query when single", () => {
    expect(buildStatusPath({ requestIds: ["4207"] })).toBe("/status/4207");
  });

  it("preserves additional ids in the more query param", () => {
    expect(buildStatusPath({ requestIds: ["4207", "4208", "4209"] })).toBe(
      "/status/4207?more=4208%2C4209",
    );
  });

  it("preserves the transaction hash", () => {
    const path = buildStatusPath({
      requestIds: ["4207"],
      transactionHash: "0xabc",
    });
    expect(path).toContain("/status/4207?");
    expect(path).toContain("tx=0xabc");
  });

  it("never carries an agent in the route (protocol assigns FIFO)", () => {
    const path = buildStatusPath({
      requestIds: ["4207"],
      transactionHash: "0xabc",
    });
    expect(path).not.toContain("agent");
  });
});

// --- readiness gate ---------------------------------------------------------

const readyState: RedemptionReadiness = {
  isConnected: true,
  correctNetwork: true,
  requiredUba: 1_000_000n,
  inputError: null,
  addressValid: true,
  tagError: null,
  tagRequested: false,
  tagSupported: true,
  balanceKnown: true,
  sufficientBalance: true,
};

describe("redemptionBlockedReason", () => {
  it("is null when everything is ready", () => {
    expect(redemptionBlockedReason(readyState)).toBeNull();
  });

  it("blocks a disconnected wallet first", () => {
    expect(
      redemptionBlockedReason({ ...readyState, isConnected: false }),
    ).toMatch(/connect a wallet/i);
  });

  it("blocks the wrong network", () => {
    expect(
      redemptionBlockedReason({ ...readyState, correctNetwork: false }),
    ).toMatch(/coston2/i);
  });

  it("surfaces the input error, then the empty-amount state", () => {
    expect(
      redemptionBlockedReason({
        ...readyState,
        inputError: "FXRP supports up to 6 decimal places.",
      }),
    ).toMatch(/decimal places/i);
    expect(
      redemptionBlockedReason({ ...readyState, requiredUba: null }),
    ).toMatch(/enter an amount/i);
  });

  it("blocks an invalid address", () => {
    expect(
      redemptionBlockedReason({ ...readyState, addressValid: false }),
    ).toMatch(/destination address/i);
  });

  it("blocks an invalid destination tag (after a valid amount and address)", () => {
    expect(
      redemptionBlockedReason({
        ...readyState,
        tagError: "Destination tag must fit in 32 bits (at most 4294967295).",
      }),
    ).toMatch(/32 bits/);
  });

  it("blocks a requested tag only when redeemWithTagSupported() is explicitly false", () => {
    // A tag was entered but the AssetManager advertises no tag support.
    expect(
      redemptionBlockedReason({
        ...readyState,
        tagRequested: true,
        tagSupported: false,
      }),
    ).toMatch(/does not support destination-tag/i);

    // A transient/unknown capability (undefined) never blocks the tag lane.
    expect(
      redemptionBlockedReason({
        ...readyState,
        tagRequested: true,
        tagSupported: undefined,
      }),
    ).toBeNull();

    // No tag requested ⇒ capability is irrelevant to the standard lane.
    expect(
      redemptionBlockedReason({
        ...readyState,
        tagRequested: false,
        tagSupported: false,
      }),
    ).toBeNull();
  });

  it("blocks insufficient balance only when the balance is known", () => {
    expect(
      redemptionBlockedReason({
        ...readyState,
        sufficientBalance: false,
      }),
    ).toMatch(/insufficient/i);
    expect(
      redemptionBlockedReason({
        ...readyState,
        balanceKnown: false,
        sufficientBalance: false,
      }),
    ).toBeNull();
  });

  it("reports the most fundamental blocker first when several fail", () => {
    // Everything is wrong at once; the wallet prerequisite wins.
    const allBad: RedemptionReadiness = {
      isConnected: false,
      correctNetwork: false,
      requiredUba: null,
      inputError: "FXRP supports up to 6 decimal places.",
      addressValid: false,
      tagError: null,
      tagRequested: false,
      tagSupported: undefined,
      balanceKnown: true,
      sufficientBalance: false,
    };
    expect(redemptionBlockedReason(allBad)).toMatch(/connect a wallet/i);

    // With the wallet connected, the network prerequisite is next.
    expect(redemptionBlockedReason({ ...allBad, isConnected: true })).toMatch(
      /coston2/i,
    );

    // Then the input error takes precedence over the empty/address/balance states.
    expect(
      redemptionBlockedReason({
        ...allBad,
        isConnected: true,
        correctNetwork: true,
      }),
    ).toMatch(/decimal places/i);

    // Address validity is checked before balance.
    expect(
      redemptionBlockedReason({
        ...allBad,
        isConnected: true,
        correctNetwork: true,
        inputError: null,
        requiredUba: 1_000_000n,
      }),
    ).toMatch(/destination address/i);
  });
});

// --- redeem-by-tag fuzz + gate matrix (extended) ---------------------------

/** Deterministic PRNG (mulberry32) so the fuzz below is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("redeem-by-tag fuzz and gate matrix", () => {
  it("fuzz: every uint32 string parses to exactly BigInt(string); >= 2**32 is an error", () => {
    const rng = mulberry32(0xc0ffee);
    for (let i = 0; i < 2000; i += 1) {
      const value = Math.floor(rng() * 4_294_967_296);
      const raw = String(value);
      const result = parseDestinationTag(raw);
      expect(result.error).toBeNull();
      expect(result.tag).toBe(BigInt(raw));
    }
    expect(parseDestinationTag("0")).toEqual({ tag: 0n, error: null });
    expect(parseDestinationTag(String(destinationTagMax))).toEqual({
      tag: destinationTagMax,
      error: null,
    });
    for (const over of ["4294967296", "4294967300", "99999999999"]) {
      const result = parseDestinationTag(over);
      expect(result.tag).toBeNull();
      expect(result.error).toMatch(/32 bits/);
    }
  });

  it("fuzz: a present tag always routes to redeemWithTag with the tag as the 4th arg", () => {
    const executor = getAddress("0x00000000000000000000000000000000000000cc");
    const rng = mulberry32(0x1234);
    for (let i = 0; i < 1000; i += 1) {
      const tag = BigInt(Math.floor(rng() * 4_294_967_296));
      const call = buildRedeemCallArgs({
        amountUba: 5_000_000n,
        xrplAddress: "rDest",
        executor,
        destinationTag: tag,
      });
      expect(call.functionName).toBe("redeemWithTag");
      if (call.functionName === "redeemWithTag") {
        expect(call.args).toEqual([5_000_000n, "rDest", executor, tag]);
      }
    }
    const standard = buildRedeemCallArgs({
      amountUba: 5_000_000n,
      xrplAddress: "rDest",
      executor,
      destinationTag: null,
    });
    expect(standard.functionName).toBe("redeemAmount");
    expect(standard.args).toEqual([5_000_000n, "rDest", executor]);
  });

  it("parseDestinationTag then buildRedeemCallArgs: empty -> redeemAmount, '0' -> redeemWithTag(tag 0)", () => {
    const executor = getAddress("0x00000000000000000000000000000000000000cc");

    const empty = parseDestinationTag("");
    expect(empty).toEqual({ tag: null, error: null });
    expect(
      buildRedeemCallArgs({
        amountUba: 1n,
        xrplAddress: "rDest",
        executor,
        destinationTag: empty.tag,
      }).functionName,
    ).toBe("redeemAmount");

    const zero = parseDestinationTag("0");
    expect(zero.tag).toBe(0n);
    const zeroCall = buildRedeemCallArgs({
      amountUba: 1n,
      xrplAddress: "rDest",
      executor,
      destinationTag: zero.tag,
    });
    expect(zeroCall.functionName).toBe("redeemWithTag");
    if (zeroCall.functionName === "redeemWithTag") {
      expect(zeroCall.args[3]).toBe(0n);
    }
  });

  it("does not block a requested tag when redeemWithTagSupported() is true", () => {
    expect(
      redemptionBlockedReason({
        ...readyState,
        tagRequested: true,
        tagSupported: true,
      }),
    ).toBeNull();
  });
});
