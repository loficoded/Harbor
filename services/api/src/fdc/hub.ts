import {
  coston2FdcHubAddress,
  coston2RelayAddress,
  fdcHubAbi,
  fdcRequestFeeConfigurationsAbi,
} from "@harbor/protocol";
import {
  normalizeEvmAddress,
  normalizeTransactionHash,
  type EvmAddress,
  type HexString,
  type TransactionHash,
} from "@harbor/shared";
import type { Abi as ViemAbi, Address } from "viem";

import { calculateFdcVotingRoundId } from "./rounds.js";
import type { FdcReadContractClient, VotingRoundTiming } from "./rounds.js";

const fdcHubWriteAbi = fdcHubAbi as unknown as ViemAbi;
const fdcRequestFeeConfigurationsReadAbi =
  fdcRequestFeeConfigurationsAbi as unknown as ViemAbi;

export type FdcHubPublicClient = FdcReadContractClient &
  Readonly<{
    waitForTransactionReceipt(parameters: { hash: TransactionHash }): Promise<{
      status?: "success" | "reverted" | string;
      blockNumber: bigint;
    }>;
    getBlock(parameters: { blockNumber: bigint }): Promise<{
      timestamp: bigint | number;
    }>;
  }>;

export type FdcHubWalletClient = Readonly<{
  writeContract(parameters: {
    address: Address;
    abi: ViemAbi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
    account?: Address;
  }): Promise<unknown>;
}>;

export type SubmitFdcAttestationRequestInput = Readonly<{
  publicClient: FdcHubPublicClient;
  walletClient: FdcHubWalletClient;
  requestBytes: HexString;
  fdcHubAddress?: EvmAddress;
  relayAddress?: EvmAddress;
  requestFeeWei?: bigint;
  account?: EvmAddress;
  fallbackTiming?: VotingRoundTiming;
}>;

export type FdcAttestationSubmission = Readonly<{
  transactionHash: TransactionHash;
  votingRoundId: bigint;
  requestFeeWei: bigint;
  blockNumber: bigint;
  blockTimestamp: bigint;
}>;

export async function readFdcRequestFee(input: {
  publicClient: FdcReadContractClient;
  requestBytes: HexString;
  fdcHubAddress?: EvmAddress | undefined;
}): Promise<bigint> {
  const fdcHubAddress = input.fdcHubAddress ?? coston2FdcHubAddress;
  const feeConfigurationsAddress = normalizeEvmAddress(
    String(
      await input.publicClient.readContract({
        address: fdcHubAddress as Address,
        abi: fdcHubWriteAbi,
        functionName: "fdcRequestFeeConfigurations",
      }),
    ),
  );

  return integerToBigint(
    await input.publicClient.readContract({
      address: feeConfigurationsAddress as Address,
      abi: fdcRequestFeeConfigurationsReadAbi,
      functionName: "getRequestFee",
      args: [input.requestBytes],
    }),
    "FDC request fee",
  );
}

export async function submitFdcAttestationRequest(
  input: SubmitFdcAttestationRequestInput,
): Promise<FdcAttestationSubmission> {
  const fdcHubAddress = input.fdcHubAddress ?? coston2FdcHubAddress;
  const relayAddress = input.relayAddress ?? coston2RelayAddress;
  const requestFeeWei =
    input.requestFeeWei ??
    (await readFdcRequestFee({
      publicClient: input.publicClient,
      requestBytes: input.requestBytes,
      fdcHubAddress,
    }));

  const writeParameters: Parameters<FdcHubWalletClient["writeContract"]>[0] = {
    address: fdcHubAddress as Address,
    abi: fdcHubWriteAbi,
    functionName: "requestAttestation",
    args: [input.requestBytes],
    value: requestFeeWei,
  };

  if (input.account !== undefined) {
    writeParameters.account = input.account as Address;
  }

  const transactionHash = normalizeTransactionHash(
    String(await input.walletClient.writeContract(writeParameters)),
  );
  const receipt = await input.publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  if (receipt.status !== undefined && receipt.status !== "success") {
    throw new Error(`FDC attestation request reverted: ${receipt.status}`);
  }

  const block = await input.publicClient.getBlock({
    blockNumber: receipt.blockNumber,
  });
  const blockTimestamp = integerToBigint(
    block.timestamp,
    "FDC request block timestamp",
  );
  const votingRoundId = await calculateFdcVotingRoundId({
    publicClient: input.publicClient,
    relayAddress,
    transactionUnixTimestamp: blockTimestamp,
    fallbackTiming: input.fallbackTiming,
  });

  return {
    transactionHash,
    votingRoundId,
    requestFeeWei,
    blockNumber: receipt.blockNumber,
    blockTimestamp,
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
