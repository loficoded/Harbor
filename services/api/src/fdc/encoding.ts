import type { Bytes32, HexString } from "@harbor/shared";

import type { StoredRedemptionRequest } from "../repositories/types.js";

/**
 * Shared FDC request-encoding primitives used by both attestation builders (the
 * standard `ReferencedPaymentNonexistence` lane and the XRP-native
 * `XRPPaymentNonexistence` lane). These were previously duplicated byte-for-byte
 * in both builders; keeping a single copy here preserves one source of truth for
 * the exact-decimal, bigint-safe field validation the FDC request bodies require.
 */

/** Maximum value of a Solidity `uint64` field. */
export const uint64Max = (1n << 64n) - 1n;

/** Concatenate `0x`-prefixed hex chunks into a single `0x`-prefixed value. */
export function concatHex(values: readonly HexString[]): HexString {
  return `0x${values.map((value) => value.slice(2)).join("")}` as HexString;
}

/**
 * Deterministic FDC request id: a stable, human-readable key of the form
 * `${lanePrefix}:${requestHash}`. The lane prefix disambiguates the standard and
 * XRP nonexistence lanes so their request ids never collide.
 */
export function fdcRequestId(lanePrefix: string, requestHash: Bytes32): string {
  return `${lanePrefix}:${requestHash}`;
}

/** Require a non-empty string field (trimmed), else throw a labelled error. */
export function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} is required`);
  }

  return value;
}

/** Require a `bigint` field, else throw a labelled error. */
export function requireBigint(value: unknown, fieldName: string): bigint {
  if (typeof value !== "bigint") {
    throw new Error(`${fieldName} is required`);
  }

  return value;
}

/** Assert a non-negative `uint256` value. */
export function uint256(value: bigint, fieldName: string): bigint {
  if (value < 0n) {
    throw new Error(`${fieldName} cannot be negative`);
  }

  return value;
}

/** Assert a non-negative value that fits a Solidity `uint64`. */
export function uint64(value: bigint, fieldName: string): bigint {
  const unsignedValue = uint256(value, fieldName);

  if (unsignedValue > uint64Max) {
    throw new Error(`${fieldName} exceeds uint64`);
  }

  return unsignedValue;
}

/**
 * Guard that a redemption's underlying payment deadline has elapsed before a
 * nonexistence proof may be built. A `dryRun` bypasses the guard (used to
 * pre-compute a request body without waiting for the window to close).
 */
export function assertDeadlinePassed(
  redemption: Pick<
    StoredRedemptionRequest,
    "assetManagerAddress" | "requestId" | "lastUnderlyingTimestamp"
  >,
  options: Readonly<{ currentUnixTimestamp?: bigint; dryRun?: boolean }>,
): void {
  if (options.dryRun === true) {
    return;
  }

  const currentUnixTimestamp =
    options.currentUnixTimestamp ?? BigInt(Math.floor(Date.now() / 1000));

  if (currentUnixTimestamp <= redemption.lastUnderlyingTimestamp) {
    throw new Error(
      `Redemption ${redemption.assetManagerAddress}/${redemption.requestId} payment deadline has not passed`,
    );
  }
}
