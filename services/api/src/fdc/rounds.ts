import { relayAbi } from "@harbor/protocol";
import type { EvmAddress } from "@harbor/shared";
import { setTimeout as defaultSleep } from "node:timers/promises";
import type { Abi as ViemAbi, Address } from "viem";

export const fdcProtocolId = 200n;
export const conservativeFdcFinalizationDelaySeconds = 180n;

const relayReadAbi = relayAbi as unknown as ViemAbi;

export type FdcReadContractClient = Readonly<{
  readContract(parameters: {
    address: Address;
    abi: ViemAbi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}>;

export type VotingRoundTiming = Readonly<{
  firstVotingRoundStartTimestamp: bigint;
  votingEpochDurationSeconds: bigint;
  source: string;
}>;

export type FdcFinalizationStatus = Readonly<{
  isFinalized: boolean;
  source: "relay" | "static-delay";
  checkedAtUnixTimestamp: bigint;
  lastError: string | null;
}>;

export type WaitForFdcFinalizationOptions = Readonly<{
  maxPolls?: number;
  pollIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  nowUnixTimestamp?: () => bigint;
}>;

/**
 * Coston2 public docs use this timing in the FDC by-hand flow. It is only a
 * fallback for demos when Relay reads are unavailable; production should use
 * Relay or FlareSystemsManager-derived timing.
 */
export const coston2StaticVotingRoundTiming = {
  firstVotingRoundStartTimestamp: 1_658_430_000n,
  votingEpochDurationSeconds: 90n,
  source: "flare-docs-coston2-static",
} as const satisfies VotingRoundTiming;

export function calculateVotingRoundIdFromTiming(
  transactionUnixTimestamp: bigint,
  timing: VotingRoundTiming = coston2StaticVotingRoundTiming,
): bigint {
  if (timing.votingEpochDurationSeconds <= 0n) {
    throw new Error("Voting epoch duration must be positive");
  }

  if (transactionUnixTimestamp < timing.firstVotingRoundStartTimestamp) {
    throw new Error(
      `Transaction timestamp ${transactionUnixTimestamp.toString()} precedes first voting round start ${timing.firstVotingRoundStartTimestamp.toString()}`,
    );
  }

  return (
    (transactionUnixTimestamp - timing.firstVotingRoundStartTimestamp) /
    timing.votingEpochDurationSeconds
  );
}

export async function calculateFdcVotingRoundId(input: {
  publicClient?: FdcReadContractClient | undefined;
  relayAddress?: EvmAddress | undefined;
  transactionUnixTimestamp: bigint;
  fallbackTiming?: VotingRoundTiming | undefined;
}): Promise<bigint> {
  if (input.publicClient !== undefined && input.relayAddress !== undefined) {
    try {
      return integerToBigint(
        await input.publicClient.readContract({
          address: input.relayAddress as Address,
          abi: relayReadAbi,
          functionName: "getVotingRoundId",
          args: [input.transactionUnixTimestamp],
        }),
        "Relay getVotingRoundId result",
      );
    } catch {
      // Static timing is deliberately isolated below for Coston2 demo fallback.
    }
  }

  return calculateVotingRoundIdFromTiming(
    input.transactionUnixTimestamp,
    input.fallbackTiming ?? coston2StaticVotingRoundTiming,
  );
}

export async function checkFdcVotingRoundFinalization(input: {
  publicClient?: FdcReadContractClient | undefined;
  relayAddress?: EvmAddress | undefined;
  votingRoundId: bigint;
  protocolId?: bigint | undefined;
  currentUnixTimestamp?: bigint | undefined;
  fallbackTiming?: VotingRoundTiming | undefined;
  finalizationDelaySeconds?: bigint | undefined;
}): Promise<FdcFinalizationStatus> {
  const checkedAtUnixTimestamp =
    input.currentUnixTimestamp ?? BigInt(Math.floor(Date.now() / 1000));
  const protocolId = input.protocolId ?? fdcProtocolId;

  if (input.publicClient !== undefined && input.relayAddress !== undefined) {
    try {
      const isFinalized = await input.publicClient.readContract({
        address: input.relayAddress as Address,
        abi: relayReadAbi,
        functionName: "isFinalized",
        args: [protocolId, input.votingRoundId],
      });

      if (typeof isFinalized !== "boolean") {
        throw new Error("Relay isFinalized result must be boolean");
      }

      return {
        isFinalized,
        source: "relay",
        checkedAtUnixTimestamp,
        lastError: null,
      };
    } catch (error) {
      return staticFinalizationStatus({
        votingRoundId: input.votingRoundId,
        currentUnixTimestamp: checkedAtUnixTimestamp,
        fallbackTiming: input.fallbackTiming,
        finalizationDelaySeconds: input.finalizationDelaySeconds,
        lastError: errorMessage(error),
      });
    }
  }

  return staticFinalizationStatus({
    votingRoundId: input.votingRoundId,
    currentUnixTimestamp: checkedAtUnixTimestamp,
    fallbackTiming: input.fallbackTiming,
    finalizationDelaySeconds: input.finalizationDelaySeconds,
    lastError: null,
  });
}

export async function waitForFdcVotingRoundFinalization(
  input: Parameters<typeof checkFdcVotingRoundFinalization>[0] &
    WaitForFdcFinalizationOptions,
): Promise<FdcFinalizationStatus> {
  const maxPolls = input.maxPolls ?? 18;
  const pollIntervalMs = input.pollIntervalMs ?? 10_000;
  const sleep = input.sleep ?? defaultSleep;
  const nowUnixTimestamp =
    input.nowUnixTimestamp ?? (() => BigInt(Math.floor(Date.now() / 1000)));
  let lastStatus: FdcFinalizationStatus | null = null;

  for (let poll = 0; poll <= maxPolls; poll += 1) {
    lastStatus = await checkFdcVotingRoundFinalization({
      ...input,
      currentUnixTimestamp: nowUnixTimestamp(),
    });

    if (lastStatus.isFinalized || poll === maxPolls) {
      return lastStatus;
    }

    await sleep(pollIntervalMs);
  }

  return lastStatus!;
}

function staticFinalizationStatus(input: {
  votingRoundId: bigint;
  currentUnixTimestamp: bigint;
  fallbackTiming?: VotingRoundTiming | undefined;
  finalizationDelaySeconds?: bigint | undefined;
  lastError: string | null;
}): FdcFinalizationStatus {
  const timing = input.fallbackTiming ?? coston2StaticVotingRoundTiming;
  const delay =
    input.finalizationDelaySeconds ?? conservativeFdcFinalizationDelaySeconds;
  const roundEndTimestamp =
    timing.firstVotingRoundStartTimestamp +
    (input.votingRoundId + 1n) * timing.votingEpochDurationSeconds;

  return {
    isFinalized: input.currentUnixTimestamp >= roundEndTimestamp + delay,
    source: "static-delay",
    checkedAtUnixTimestamp: input.currentUnixTimestamp,
    lastError: input.lastError,
  };
}

function integerToBigint(value: unknown, name: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }

  throw new Error(`${name} must be an integer`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
