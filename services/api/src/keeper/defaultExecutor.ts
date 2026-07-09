import { harborRedeemerAbi } from "@harbor/protocol";
import {
  normalizeBytes32,
  normalizeEvmAddress,
  normalizeTransactionHash,
  type Bytes32,
  type EvmAddress,
  type TransactionHash,
} from "@harbor/shared";
import type { Abi as ViemAbi, Address } from "viem";

import type { ReferencedPaymentNonexistenceProofCalldata } from "../fdc/daLayer.js";
import type {
  StoredFdcProofRecord,
  StoredRedemptionRequest,
} from "../repositories/types.js";

export type DefaultTransactionReceiptStatus =
  "success" | "reverted" | "pending" | "not_found" | string;

export type DefaultTransactionReceipt = Readonly<{
  status?: DefaultTransactionReceiptStatus;
  transactionHash?: TransactionHash;
}>;

export type HarborDefaultWalletClient = Readonly<{
  writeContract(parameters: {
    address: Address;
    abi: ViemAbi;
    functionName: string;
    args?: readonly unknown[];
    account?: Address;
  }): Promise<unknown>;
}>;

export type HarborDefaultPublicClient = Readonly<{
  waitForTransactionReceipt(parameters: {
    hash: TransactionHash;
  }): Promise<DefaultTransactionReceipt>;
  getTransactionReceipt?(parameters: {
    hash: TransactionHash;
  }): Promise<DefaultTransactionReceipt>;
}>;

export type ExecuteHarborDefaultInput = Readonly<{
  redemption: StoredRedemptionRequest;
  proof: StoredFdcProofRecord;
}>;

export type ExecuteHarborDefaultResult = Readonly<{
  transactionHash: TransactionHash;
}>;

export type KeeperDefaultExecutor = Readonly<{
  executeDefault(
    input: ExecuteHarborDefaultInput,
  ): Promise<ExecuteHarborDefaultResult>;
  getTransactionReceipt?(
    transactionHash: TransactionHash,
  ): Promise<DefaultTransactionReceipt | null>;
}>;

export class DefaultExecutionRevertedError extends Error {
  readonly transactionHash: TransactionHash | null;

  constructor(message: string, transactionHash: TransactionHash | null = null) {
    super(message);
    this.name = "DefaultExecutionRevertedError";
    this.transactionHash = transactionHash;
  }
}

export class LatePaymentFinalizedError extends Error {
  constructor(message = "Default execution reverted after a valid payment") {
    super(message);
    this.name = "LatePaymentFinalizedError";
  }
}

export function isLatePaymentFinalizedError(error: unknown): boolean {
  if (error instanceof LatePaymentFinalizedError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);

  return /(?:late|valid|already|finali[sz]ed|performed|fulfilled|paid).*(?:payment|redemption)|(?:payment|redemption).*(?:already|finali[sz]ed|performed|fulfilled|paid)/iu.test(
    message,
  );
}

export function parseStoredFdcProofCalldata(
  proof: StoredFdcProofRecord,
): ReferencedPaymentNonexistenceProofCalldata {
  if (proof.calldataJson === null) {
    throw new Error(`FDC proof ${proof.fdcProofId} has no calldata JSON`);
  }

  const payload = requireRecord(
    JSON.parse(proof.calldataJson) as unknown,
    "proof calldata",
  );
  const data = requireRecord(payload.data, "proof calldata data");
  const requestBody = requireRecord(
    data.requestBody,
    "proof calldata request body",
  );
  const responseBody = requireRecord(
    data.responseBody,
    "proof calldata response body",
  );

  return {
    merkleProof: requireArray(payload.merkleProof, "merkleProof").map((entry) =>
      normalizeBytes32(requireString(entry, "merkleProof entry")),
    ),
    data: {
      attestationType: normalizeBytes32(
        requireString(data.attestationType, "attestationType"),
      ),
      sourceId: normalizeBytes32(requireString(data.sourceId, "sourceId")),
      votingRound: unsignedBigint(data.votingRound, "votingRound"),
      lowestUsedTimestamp: unsignedBigint(
        data.lowestUsedTimestamp,
        "lowestUsedTimestamp",
      ),
      requestBody: {
        minimalBlockNumber: unsignedBigint(
          requestBody.minimalBlockNumber,
          "minimalBlockNumber",
        ),
        deadlineBlockNumber: unsignedBigint(
          requestBody.deadlineBlockNumber,
          "deadlineBlockNumber",
        ),
        deadlineTimestamp: unsignedBigint(
          requestBody.deadlineTimestamp,
          "deadlineTimestamp",
        ),
        destinationAddressHash: normalizeBytes32(
          requireString(
            requestBody.destinationAddressHash,
            "destinationAddressHash",
          ),
        ),
        amount: unsignedBigint(requestBody.amount, "amount"),
        standardPaymentReference: normalizeBytes32(
          requireString(
            requestBody.standardPaymentReference,
            "standardPaymentReference",
          ),
        ),
        checkSourceAddresses: requireBoolean(
          requestBody.checkSourceAddresses,
          "checkSourceAddresses",
        ),
        sourceAddressesRoot: normalizeBytes32(
          requireString(requestBody.sourceAddressesRoot, "sourceAddressesRoot"),
        ),
      },
      responseBody: {
        minimalBlockTimestamp: unsignedBigint(
          responseBody.minimalBlockTimestamp,
          "minimalBlockTimestamp",
        ),
        firstOverflowBlockNumber: unsignedBigint(
          responseBody.firstOverflowBlockNumber,
          "firstOverflowBlockNumber",
        ),
        firstOverflowBlockTimestamp: unsignedBigint(
          responseBody.firstOverflowBlockTimestamp,
          "firstOverflowBlockTimestamp",
        ),
      },
    },
  };
}

export function buildExecuteDefaultParameters(input: {
  harborRedeemerAddress: EvmAddress;
  redemption: StoredRedemptionRequest;
  proof: StoredFdcProofRecord;
  account?: EvmAddress | undefined;
}): {
  address: Address;
  abi: ViemAbi;
  functionName: "executeDefault";
  args: readonly [ReferencedPaymentNonexistenceProofCalldata, bigint];
  account?: Address;
} {
  const parameters = {
    address: normalizeEvmAddress(input.harborRedeemerAddress) as Address,
    abi: harborRedeemerAbi as unknown as ViemAbi,
    functionName: "executeDefault",
    args: [
      parseStoredFdcProofCalldata(input.proof),
      BigInt(input.redemption.requestId),
    ],
  } as const;

  if (input.account === undefined) {
    return parameters;
  }

  return {
    ...parameters,
    account: normalizeEvmAddress(input.account) as Address,
  };
}

export function createHarborRedeemerDefaultExecutor(input: {
  harborRedeemerAddress: EvmAddress;
  walletClient: HarborDefaultWalletClient;
  publicClient: HarborDefaultPublicClient;
  account?: EvmAddress | undefined;
}): KeeperDefaultExecutor {
  return {
    async executeDefault({
      redemption,
      proof,
    }: ExecuteHarborDefaultInput): Promise<ExecuteHarborDefaultResult> {
      const writeParameters = buildExecuteDefaultParameters({
        harborRedeemerAddress: input.harborRedeemerAddress,
        redemption,
        proof,
        ...(input.account === undefined ? {} : { account: input.account }),
      });
      const transactionHash = normalizeTransactionHash(
        String(await input.walletClient.writeContract(writeParameters)),
      );
      const receipt = await input.publicClient.waitForTransactionReceipt({
        hash: transactionHash,
      });

      if (receipt.status !== undefined && receipt.status !== "success") {
        throw new DefaultExecutionRevertedError(
          `executeDefault reverted: ${receipt.status}`,
          transactionHash,
        );
      }

      return { transactionHash };
    },

    async getTransactionReceipt(
      transactionHash: TransactionHash,
    ): Promise<DefaultTransactionReceipt | null> {
      if (input.publicClient.getTransactionReceipt === undefined) {
        return null;
      }

      try {
        return await input.publicClient.getTransactionReceipt({
          hash: transactionHash,
        });
      } catch (error) {
        if (isTransactionNotFoundError(error)) {
          return null;
        }

        throw error;
      }
    },
  };
}

function isTransactionNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /transaction.*(?:not found|could not be found)|not found.*transaction/iu.test(
    message,
  );
}

function requireRecord(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requireArray(value: unknown, fieldName: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }

  return value;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return value;
}

function unsignedBigint(value: unknown, fieldName: string): bigint {
  if (typeof value === "bigint" && value >= 0n) {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^(0|[1-9]\d*)$/u.test(value)) {
    return BigInt(value);
  }

  throw new Error(`${fieldName} must be a non-negative integer`);
}
