import { sha256 } from "viem";

/**
 * Reliable, dependency-free XRPL classic ("r...") address validation.
 *
 * FXRP redemptions settle by paying an XRPL classic address, so an invalid
 * destination silently burns the redemption. Rather than a naive character
 * check, this performs full base58check validation with the XRPL dictionary and
 * a double-SHA-256 checksum — the same algorithm `ripple-address-codec` uses —
 * so transposed or mistyped characters are rejected before submission. The
 * SHA-256 primitive is viem's audited implementation (already a dependency), so
 * no new package is added to the frozen workspace lockfile.
 *
 * Only classic addresses are accepted. X-addresses (`X`/`T` prefixed) are not
 * valid underlying redemption destinations in the FAssets flow and are
 * rejected.
 */

/** The XRPL base58 dictionary (the "ripple" alphabet). */
export const XRPL_BASE58_ALPHABET =
  "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

const ALPHABET_MAP: ReadonlyMap<string, number> = new Map(
  [...XRPL_BASE58_ALPHABET].map((char, index) => [char, index]),
);

/** Version byte prefixing a classic account id (`0x00`). */
const CLASSIC_ADDRESS_PREFIX = 0x00;

/** 1 version byte + 20-byte account id + 4-byte checksum. */
const DECODED_LENGTH = 25;
const CHECKSUM_LENGTH = 4;

/**
 * Decode a base58 string using the XRPL alphabet into its raw bytes, preserving
 * leading zero bytes (encoded as leading `r` characters). Returns `null` when
 * the input contains a character outside the dictionary.
 */
export function decodeXrplBase58(input: string): Uint8Array | null {
  if (input.length === 0) {
    return null;
  }

  let accumulator = 0n;
  for (const char of input) {
    const value = ALPHABET_MAP.get(char);
    if (value === undefined) {
      return null;
    }
    accumulator = accumulator * 58n + BigInt(value);
  }

  const bytes: number[] = [];
  while (accumulator > 0n) {
    bytes.unshift(Number(accumulator & 0xffn));
    accumulator >>= 8n;
  }

  // Each leading zero-index character ("r") encodes a leading 0x00 byte.
  for (const char of input) {
    if (char === XRPL_BASE58_ALPHABET[0]) {
      bytes.unshift(0);
    } else {
      break;
    }
  }

  return Uint8Array.from(bytes);
}

/**
 * True when `address` is a checksum-valid XRPL classic address. Input is
 * trimmed first; any surrounding whitespace is ignored.
 */
export function isValidXrplClassicAddress(address: string): boolean {
  if (typeof address !== "string") {
    return false;
  }

  const trimmed = address.trim();
  if (!trimmed.startsWith("r")) {
    return false;
  }

  const decoded = decodeXrplBase58(trimmed);
  if (decoded === null || decoded.length !== DECODED_LENGTH) {
    return false;
  }

  if (decoded[0] !== CLASSIC_ADDRESS_PREFIX) {
    return false;
  }

  const payload = decoded.slice(0, DECODED_LENGTH - CHECKSUM_LENGTH);
  const checksum = decoded.slice(DECODED_LENGTH - CHECKSUM_LENGTH);
  const expected = sha256(sha256(payload, "bytes"), "bytes");

  for (let index = 0; index < CHECKSUM_LENGTH; index += 1) {
    if (checksum[index] !== expected[index]) {
      return false;
    }
  }

  return true;
}

export type XrplAddressValidation = Readonly<{
  /** Whether the trimmed value is a checksum-valid classic address. */
  valid: boolean;
  /** Trimmed address (safe to submit) when valid, else `null`. */
  address: string | null;
  /**
   * User-facing reason to surface. `null` for an empty field (nothing to
   * complain about yet) so the form stays quiet until the user types.
   */
  reason: string | null;
}>;

/**
 * Validate a raw destination-address input for display. Distinguishes an empty
 * field (no message) from a present-but-invalid value (actionable message).
 */
export function validateXrplDestination(raw: string): XrplAddressValidation {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return { valid: false, address: null, reason: null };
  }

  if (!isValidXrplClassicAddress(trimmed)) {
    return {
      valid: false,
      address: null,
      reason: "Enter a valid XRPL classic address (starts with “r”).",
    };
  }

  return { valid: true, address: trimmed, reason: null };
}
