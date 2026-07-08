import { ftsoV2Abi } from "@harbor/protocol";
import type { EvmAddress, IsoTimestamp } from "@harbor/shared";
import type { Abi as ViemAbi, Address } from "viem";

import type { AgentReliabilityFtsoStatus } from "../repositories/types.js";

export const defaultFtsoMaxAgeSeconds = 3_600;
export const xrpUsdFtsoFeedId =
  "0x015852502f55534400000000000000000000000000" as const;
export const flrUsdFtsoFeedId =
  "0x01464c522f55534400000000000000000000000000" as const;

const ftsoReadAbi = ftsoV2Abi as unknown as ViemAbi;
const ftsoFeedIds = [xrpUsdFtsoFeedId, flrUsdFtsoFeedId] as const;

export type FtsoFeedId = (typeof ftsoFeedIds)[number];
export type FtsoFeedName = "XRP/USD" | "FLR/USD";

export type FtsoReadContractClient = Readonly<{
  readContract(parameters: {
    address: Address;
    abi: ViemAbi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  }): Promise<unknown>;
}>;

export type FtsoFeedValue = Readonly<{
  feedId: FtsoFeedId;
  name: FtsoFeedName;
  value: bigint;
  decimals: number;
  timestamp: bigint;
  price: string;
}>;

export type FtsoPriceSnapshot = Readonly<{
  status: AgentReliabilityFtsoStatus;
  xrpUsd: FtsoFeedValue | null;
  flrUsd: FtsoFeedValue | null;
  timestamp: bigint | null;
  readAt: IsoTimestamp;
  error: string | null;
}>;

type FeedsByIdResult = Readonly<{
  values: readonly bigint[];
  decimals: readonly number[];
  timestamp: bigint;
}>;

export function unavailableFtsoPriceSnapshot(
  readAt: IsoTimestamp = new Date().toISOString(),
): FtsoPriceSnapshot {
  return {
    status: "UNAVAILABLE",
    xrpUsd: null,
    flrUsd: null,
    timestamp: null,
    readAt,
    error: null,
  };
}

export async function readFtsoPriceSnapshot(input: {
  ftsoClient: FtsoReadContractClient;
  ftsoV2Address: EvmAddress;
  readAt?: IsoTimestamp | undefined;
  maxAgeSeconds?: number | undefined;
}): Promise<FtsoPriceSnapshot> {
  const readAt = input.readAt ?? new Date().toISOString();
  const maxAgeSeconds = input.maxAgeSeconds ?? defaultFtsoMaxAgeSeconds;
  validateMaxAge(maxAgeSeconds);

  const fee = integerToBigint(
    await input.ftsoClient.readContract({
      address: input.ftsoV2Address as Address,
      abi: ftsoReadAbi,
      functionName: "calculateFeeByIds",
      args: [ftsoFeedIds],
    }),
    "FTSO calculateFeeByIds fee",
  );
  const result = parseFeedsByIdResult(
    await input.ftsoClient.readContract({
      address: input.ftsoV2Address as Address,
      abi: ftsoReadAbi,
      functionName: "getFeedsById",
      args: [ftsoFeedIds],
      value: fee,
    }),
  );
  const xrpUsd = buildFeedValue(
    xrpUsdFtsoFeedId,
    "XRP/USD",
    result.values[0],
    result.decimals[0],
    result.timestamp,
  );
  const flrUsd = buildFeedValue(
    flrUsdFtsoFeedId,
    "FLR/USD",
    result.values[1],
    result.decimals[1],
    result.timestamp,
  );
  const status = isFtsoSnapshotStale(result.timestamp, readAt, maxAgeSeconds)
    ? "STALE"
    : "AVAILABLE";

  return {
    status,
    xrpUsd,
    flrUsd,
    timestamp: result.timestamp,
    readAt,
    error: null,
  };
}

export async function readOptionalFtsoPriceSnapshot(input: {
  ftsoClient?: FtsoReadContractClient | undefined;
  ftsoV2Address?: EvmAddress | undefined;
  readAt?: IsoTimestamp | undefined;
  maxAgeSeconds?: number | undefined;
}): Promise<FtsoPriceSnapshot> {
  const readAt = input.readAt ?? new Date().toISOString();

  if (input.ftsoClient === undefined || input.ftsoV2Address === undefined) {
    return unavailableFtsoPriceSnapshot(readAt);
  }

  try {
    return await readFtsoPriceSnapshot({
      ftsoClient: input.ftsoClient,
      ftsoV2Address: input.ftsoV2Address,
      readAt,
      maxAgeSeconds: input.maxAgeSeconds,
    });
  } catch (error) {
    return {
      status: "FAILED",
      xrpUsd: null,
      flrUsd: null,
      timestamp: null,
      readAt,
      error: errorMessage(error),
    };
  }
}

export function feedValueToNumber(feedValue: FtsoFeedValue): number | null {
  const value = Number(feedValue.value);

  if (!Number.isFinite(value)) {
    return null;
  }

  return feedValue.decimals >= 0
    ? value / 10 ** feedValue.decimals
    : value * 10 ** Math.abs(feedValue.decimals);
}

function parseFeedsByIdResult(result: unknown): FeedsByIdResult {
  const values = readResultField(result, ["_values", "values"], 0);
  const decimals = readResultField(result, ["_decimals", "decimals"], 1);
  const timestamp = readResultField(result, ["_timestamp", "timestamp"], 2);

  if (!Array.isArray(values)) {
    throw new Error("FTSO getFeedsById returned non-array values");
  }

  if (!Array.isArray(decimals)) {
    throw new Error("FTSO getFeedsById returned non-array decimals");
  }

  if (
    values.length < ftsoFeedIds.length ||
    decimals.length < ftsoFeedIds.length
  ) {
    throw new Error("FTSO getFeedsById returned too few feed values");
  }

  return {
    values: values
      .slice(0, ftsoFeedIds.length)
      .map((value, index) => integerToBigint(value, `FTSO value ${index}`)),
    decimals: decimals
      .slice(0, ftsoFeedIds.length)
      .map((value, index) =>
        integerToSafeNumber(value, `FTSO decimals ${index}`),
      ),
    timestamp: integerToBigint(timestamp, "FTSO timestamp"),
  };
}

function buildFeedValue(
  feedId: FtsoFeedId,
  name: FtsoFeedName,
  value: bigint | undefined,
  decimals: number | undefined,
  timestamp: bigint,
): FtsoFeedValue {
  if (value === undefined || decimals === undefined) {
    throw new Error(`FTSO ${name} feed is missing`);
  }

  return {
    feedId,
    name,
    value,
    decimals,
    timestamp,
    price: decimalString(value, decimals),
  };
}

function readResultField(
  result: unknown,
  fieldNames: readonly string[],
  index: number,
): unknown {
  if (Array.isArray(result)) {
    return result[index];
  }

  if (result !== null && typeof result === "object") {
    const record = result as Record<string, unknown>;

    for (const fieldName of fieldNames) {
      if (Object.prototype.hasOwnProperty.call(record, fieldName)) {
        return record[fieldName];
      }
    }
  }

  return undefined;
}

function integerToBigint(value: unknown, fieldName: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value);
  }

  throw new Error(`${fieldName} must be an integer`);
}

function integerToSafeNumber(value: unknown, fieldName: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    if (
      value > BigInt(Number.MAX_SAFE_INTEGER) ||
      value < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new Error(`${fieldName} must be a safe integer`);
    }

    return Number(value);
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return integerToSafeNumber(BigInt(value), fieldName);
  }

  throw new Error(`${fieldName} must be a safe integer`);
}

function isFtsoSnapshotStale(
  timestamp: bigint,
  readAt: IsoTimestamp,
  maxAgeSeconds: number,
): boolean {
  const readAtMilliseconds = Date.parse(readAt);

  if (!Number.isFinite(readAtMilliseconds)) {
    throw new Error(`Invalid FTSO read timestamp: ${readAt}`);
  }

  const timestampSeconds = Number(timestamp);

  if (!Number.isSafeInteger(timestampSeconds)) {
    return false;
  }

  return (
    Math.floor(readAtMilliseconds / 1000) - timestampSeconds > maxAgeSeconds
  );
}

function validateMaxAge(maxAgeSeconds: number): void {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
    throw new Error("FTSO max age must be a non-negative safe integer");
  }
}

function decimalString(value: bigint, decimals: number): string {
  if (decimals <= 0) {
    return `${value.toString()}${"0".repeat(Math.abs(decimals))}`;
  }

  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString();
  const paddedDigits = digits.padStart(decimals + 1, "0");
  const integerPart = paddedDigits.slice(0, -decimals);
  const fractionalPart = paddedDigits.slice(-decimals).replace(/0+$/, "");

  return fractionalPart.length === 0
    ? `${sign}${integerPart}`
    : `${sign}${integerPart}.${fractionalPart}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
