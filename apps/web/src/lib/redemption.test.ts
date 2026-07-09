import {
  buildStatusPath,
  DEFAULT_FXRP_LOT_SIZE_UBA,
  formatFxrpAmount,
  hasSufficientBalance,
  isApprovalRequired,
  lotSizeUbaFromSettings,
  lotsToUba,
  parseLotCount,
  parseRedemptionRequestIds,
  redemptionBlockedReason,
  resolveExecutor,
  type RedemptionReadiness,
} from "@/lib/redemption";
import {
  NOISE_LOG,
  redemptionRequestedLog,
} from "@/test/redemption-fixtures";
import { getAddress, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

// --- lot count --------------------------------------------------------------

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
    expect(formatFxrpAmount(lotsToUba(1n, DEFAULT_FXRP_LOT_SIZE_UBA))).toBe("10");
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
    expect(
      parseRedemptionRequestIds([{ data: "0x", topics: [] }]),
    ).toEqual([]);
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
    expect(
      buildStatusPath({ requestIds: ["4207", "4208", "4209"] }),
    ).toBe("/status/4207?more=4208%2C4209");
  });

  it("preserves the transaction hash and preferred agent", () => {
    const path = buildStatusPath({
      requestIds: ["4207"],
      transactionHash: "0xabc",
      agentVault: "0xdef",
    });
    expect(path).toContain("/status/4207?");
    expect(path).toContain("tx=0xabc");
    expect(path).toContain("agent=0xdef");
  });
});

// --- readiness gate ---------------------------------------------------------

const readyState: RedemptionReadiness = {
  isConnected: true,
  correctNetwork: true,
  lots: 1n,
  lotError: null,
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

  it("surfaces the lot error, then the empty lot state", () => {
    expect(
      redemptionBlockedReason({
        ...readyState,
        lotError: "Enter a whole number of lots.",
      }),
    ).toMatch(/whole number/i);
    expect(
      redemptionBlockedReason({ ...readyState, lots: null }),
    ).toMatch(/lot count/i);
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
