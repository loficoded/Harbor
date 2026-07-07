export type EvmAddress = `0x${string}`;
export type HexString = `0x${string}`;
export type Bytes32 = `0x${string}`;
export type TransactionHash = Bytes32;
export type RedemptionRequestId = string;

const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const hexBytes32Pattern = /^[a-fA-F0-9]{64}$/;
const decimalIntegerPattern = /^\d+$/;

export function normalizeEvmAddress(value: string): EvmAddress {
  const trimmedValue = value.trim();

  if (!evmAddressPattern.test(trimmedValue)) {
    throw new Error(`Invalid EVM address: ${value}`);
  }

  return trimmedValue.toLowerCase() as EvmAddress;
}

export function normalizeRequestId(
  value: string | number | bigint,
): RedemptionRequestId {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`Invalid request id: ${value.toString()}`);
    }

    return value.toString();
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid request id: ${value.toString()}`);
    }

    return value.toString();
  }

  const trimmedValue = value.trim();

  if (!decimalIntegerPattern.test(trimmedValue)) {
    throw new Error(`Invalid request id: ${value}`);
  }

  return BigInt(trimmedValue).toString();
}

export function normalizeBytes32(value: string): Bytes32 {
  const trimmedValue = value.trim();
  const hexValue = trimmedValue.toLowerCase().startsWith("0x")
    ? trimmedValue.slice(2)
    : trimmedValue;

  if (!hexBytes32Pattern.test(hexValue)) {
    throw new Error(`Invalid bytes32 value: ${value}`);
  }

  return `0x${hexValue.toLowerCase()}` as Bytes32;
}

export function normalizeTransactionHash(value: string): TransactionHash {
  return normalizeBytes32(value);
}
