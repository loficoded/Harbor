import {
  encodeAbiParameters,
  encodeEventTopics,
  zeroAddress,
  type Hex,
} from "viem";

/**
 * Local, precisely-typed copy of the `RedemptionRequested` event used only by
 * tests to synthesize receipt logs. Its signature matches the AssetManager
 * events ABI in `@harbor/protocol` exactly, so the topic0 (and therefore what
 * `parseRedemptionRequestIds` decodes) is identical to the real event.
 */
export const redemptionRequestedEventAbi = [
  {
    type: "event",
    name: "RedemptionRequested",
    inputs: [
      { name: "agentVault", type: "address", indexed: true },
      { name: "redeemer", type: "address", indexed: true },
      { name: "requestId", type: "uint256", indexed: true },
      { name: "paymentAddress", type: "string", indexed: false },
      { name: "valueUBA", type: "uint256", indexed: false },
      { name: "feeUBA", type: "uint256", indexed: false },
      { name: "firstUnderlyingBlock", type: "uint256", indexed: false },
      { name: "lastUnderlyingBlock", type: "uint256", indexed: false },
      { name: "lastUnderlyingTimestamp", type: "uint256", indexed: false },
      { name: "paymentReference", type: "bytes32", indexed: false },
      { name: "executor", type: "address", indexed: false },
      { name: "executorFeeNatWei", type: "uint256", indexed: false },
    ],
  },
] as const;

const NON_INDEXED = [
  { name: "paymentAddress", type: "string" },
  { name: "valueUBA", type: "uint256" },
  { name: "feeUBA", type: "uint256" },
  { name: "firstUnderlyingBlock", type: "uint256" },
  { name: "lastUnderlyingBlock", type: "uint256" },
  { name: "lastUnderlyingTimestamp", type: "uint256" },
  { name: "paymentReference", type: "bytes32" },
  { name: "executor", type: "address" },
  { name: "executorFeeNatWei", type: "uint256" },
] as const;

export type RedemptionLogFixture = Readonly<{
  data: Hex;
  topics: readonly Hex[];
}>;

/** Build a realistic RedemptionRequested log for the given request id. */
export function redemptionRequestedLog(
  requestId: bigint,
  opts?: {
    agentVault?: `0x${string}`;
    redeemer?: `0x${string}`;
    paymentAddress?: string;
    executor?: `0x${string}`;
  },
): RedemptionLogFixture {
  const agentVault =
    opts?.agentVault ?? "0x00000000000000000000000000000000000000a1";
  const redeemer =
    opts?.redeemer ?? "0x00000000000000000000000000000000000000b2";

  // All three indexed args are provided, so no topic is null at runtime.
  const topics = encodeEventTopics({
    abi: redemptionRequestedEventAbi,
    eventName: "RedemptionRequested",
    args: { agentVault, redeemer, requestId },
  }) as Hex[];

  const data = encodeAbiParameters(NON_INDEXED, [
    opts?.paymentAddress ?? "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    10_000_000n,
    0n,
    100n,
    200n,
    1_700_000_000n,
    "0x4642505266410001000000000000000000000000000000000000000000000001",
    opts?.executor ?? zeroAddress,
    0n,
  ]);

  return { data, topics };
}

/**
 * Local copy of the `RedemptionWithTagRequested` event for tests. A tag
 * redemption emits this — NOT `RedemptionRequested` — so the receipt parser
 * must accept it. Signature matches the AssetManager events ABI exactly.
 */
export const redemptionWithTagRequestedEventAbi = [
  {
    type: "event",
    name: "RedemptionWithTagRequested",
    inputs: [
      { name: "agentVault", type: "address", indexed: true },
      { name: "redeemer", type: "address", indexed: true },
      { name: "requestId", type: "uint256", indexed: true },
      { name: "paymentAddress", type: "string", indexed: false },
      { name: "valueUBA", type: "uint256", indexed: false },
      { name: "feeUBA", type: "uint256", indexed: false },
      { name: "firstUnderlyingBlock", type: "uint256", indexed: false },
      { name: "lastUnderlyingBlock", type: "uint256", indexed: false },
      { name: "lastUnderlyingTimestamp", type: "uint256", indexed: false },
      { name: "paymentReference", type: "bytes32", indexed: false },
      { name: "executor", type: "address", indexed: false },
      { name: "executorFeeNatWei", type: "uint256", indexed: false },
      { name: "destinationTag", type: "uint256", indexed: false },
    ],
  },
] as const;

const NON_INDEXED_WITH_TAG = [
  ...NON_INDEXED,
  { name: "destinationTag", type: "uint256" },
] as const;

/** Build a realistic RedemptionWithTagRequested log for the given request id. */
export function redemptionWithTagRequestedLog(
  requestId: bigint,
  opts?: {
    agentVault?: `0x${string}`;
    redeemer?: `0x${string}`;
    paymentAddress?: string;
    executor?: `0x${string}`;
    destinationTag?: bigint;
  },
): RedemptionLogFixture {
  const agentVault =
    opts?.agentVault ?? "0x00000000000000000000000000000000000000a1";
  const redeemer =
    opts?.redeemer ?? "0x00000000000000000000000000000000000000b2";

  const topics = encodeEventTopics({
    abi: redemptionWithTagRequestedEventAbi,
    eventName: "RedemptionWithTagRequested",
    args: { agentVault, redeemer, requestId },
  }) as Hex[];

  const data = encodeAbiParameters(NON_INDEXED_WITH_TAG, [
    opts?.paymentAddress ?? "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    10_000_000n,
    0n,
    100n,
    200n,
    1_700_000_000n,
    "0x4642505266410001000000000000000000000000000000000000000000000001",
    opts?.executor ?? zeroAddress,
    0n,
    opts?.destinationTag ?? 12345n,
  ]);

  return { data, topics };
}

/** An unrelated ERC-20 Transfer topic0 the AssetManager events ABI won't match. */
export const NOISE_LOG: RedemptionLogFixture = {
  data: "0x",
  topics: [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  ],
};
