import { isValidXrplClassicAddress, validateXrplDestination } from "@/lib/xrpl";
import { describe, expect, it } from "vitest";

// Well-known checksum-valid XRPL classic addresses.
const VALID_ADDRESSES = [
  "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY",
  "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
  "rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn",
  "rrrrrrrrrrrrrrrrrrrrrhoLvTp", // ACCOUNT_ZERO
];

describe("isValidXrplClassicAddress", () => {
  it("accepts checksum-valid classic addresses", () => {
    for (const address of VALID_ADDRESSES) {
      expect(isValidXrplClassicAddress(address)).toBe(true);
    }
  });

  it("rejects an address with a corrupted checksum", () => {
    // Last character flipped from the first valid address.
    expect(
      isValidXrplClassicAddress("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTX"),
    ).toBe(false);
  });

  it("rejects X-addresses and non-classic prefixes", () => {
    expect(
      isValidXrplClassicAddress("XVXdnJULOanEs5NfHBWLwZBBqTWNR7dJpM"),
    ).toBe(false);
    expect(
      isValidXrplClassicAddress("0x0000000000000000000000000000000000000000"),
    ).toBe(false);
  });

  it("rejects characters outside the base58 dictionary", () => {
    // 0, O, I and l are not in the XRPL alphabet.
    expect(isValidXrplClassicAddress("r0OIl00000000000000000000000")).toBe(
      false,
    );
  });

  it("rejects empty, truncated, and garbage inputs", () => {
    expect(isValidXrplClassicAddress("")).toBe(false);
    expect(isValidXrplClassicAddress("r")).toBe(false);
    expect(isValidXrplClassicAddress("notanaddress")).toBe(false);
    expect(isValidXrplClassicAddress("rHb9CJAWyB4rj91VRWn96DkukG4bwdty")).toBe(
      false,
    );
  });

  it("ignores surrounding whitespace", () => {
    expect(
      isValidXrplClassicAddress("  rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh  "),
    ).toBe(true);
  });
});

describe("validateXrplDestination", () => {
  it("treats an empty field as incomplete, not an error", () => {
    expect(validateXrplDestination("")).toEqual({
      valid: false,
      address: null,
      reason: null,
    });
    expect(validateXrplDestination("   ")).toEqual({
      valid: false,
      address: null,
      reason: null,
    });
  });

  it("returns an actionable reason for a present-but-invalid value", () => {
    const result = validateXrplDestination("not-valid");
    expect(result.valid).toBe(false);
    expect(result.address).toBeNull();
    expect(result.reason).toMatch(/valid XRPL/i);
  });

  it("returns the trimmed address when valid", () => {
    const result = validateXrplDestination(
      "  rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh ",
    );
    expect(result.valid).toBe(true);
    expect(result.address).toBe("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh");
    expect(result.reason).toBeNull();
  });
});
