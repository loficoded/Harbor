import {
  buildStatusPath,
  DEFAULT_FXRP_LOT_SIZE_UBA,
  FXRP_DECIMALS,
  formatFxrpAmount,
  hasSufficientBalance,
  isApprovalRequired,
  lotSizeUbaFromSettings,
  lotsToUba,
  parseLotCount,
  parseRedeemAmount,
  parseRedemptionRequestIds,
  redemptionBlockedReason,
  resolveExecutor,
  type RedemptionReadiness,
} from "@/lib/redemption";
import { NOISE_LOG, redemptionRequestedLog } from "@/test/redemption-fixtures";
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
});

// --- lot count (advanced mode) ---------------------------------------------

describe("parseLotCount", () => {
  it("treats an empty field as incomplete, not an error", () => {
    expect(parseLotCount("")).toEqual({ lots: null, error: null });
    expect(parseLotCount("   ")).toEqual({ lots: null, error: null });
  });

  it("parses a positive whole number", () => {
    expect(parseLotCount("3")).toEqual({ lots: 3n, error: null });
    expect(parseLotCount(" 5 ")).toEqual({ lots: 5n, error: null });
  });

  it("rejects zero and negatives", () => {
    expect(parseLotCount("0").lots).toBeNull();
    expect(parseLotCount("0").error).toMatch(/at least one/i);
    expect(parseLotCount("-2").lots).toBeNull();
    expect(parseLotCount("-2").error).toMatch(/whole number/i);
  });

  it("rejects non-integers and non-numeric input", () => {
    expect(parseLotCount("1.5").error).toMatch(/whole number/i);
    expect(parseLotCount("abc").error).toMatch(/whole number/i);
  });
});

// --- amount math ------------------------------------------------------------

describe("lot size and amount", () => {
  it("derives lot size from AssetManager settings when present", () => {
    expect(
      lotSizeUbaFromSettings({
        lotSizeAMG: 5n,
        assetMintingGranularityUBA: 2_000_000n,
      }),
    ).toBe(10_000_000n);
  });

  it("falls back to the protocol helper when settings are missing or zero", () => {
    expect(lotSizeUbaFromSettings(undefined)).toBe(DEFAULT_FXRP_LOT_SIZE_UBA);
    expect(
      lotSizeUbaFromSettings({
        lotSizeAMG: 0n,
        assetMintingGranularityUBA: 0n,
      }),
    ).toBe(DEFAULT_FXRP_LOT_SIZE_UBA);
  });

  it("computes UBA and formats FXRP", () => {
    const uba = lotsToUba(3n, DEFAULT_FXRP_LOT_SIZE_UBA);
    expect(uba).toBe(30_000_000n);
    expect(formatFxrpAmount(uba)).toBe("30");
    expect(formatFxrpAmount(lotsToUba(1n, DEFAULT_FXRP_LOT_SIZE_UBA))).toBe(
      "10",
    );
    // Round-trips an arbitrary parsed amount back to its display form.
    expect(formatFxrpAmount(2_370_000n)).toBe("2.37");
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
});
