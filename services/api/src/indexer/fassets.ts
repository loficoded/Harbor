import {
  assetManagerEventsAbi,
  harborRedeemerAbi,
  type Abi as ProtocolAbi,
} from "@harbor/protocol";
import {
  normalizeBytes32,
  normalizeEvmAddress,
  normalizeRequestId,
  normalizeTransactionHash,
  type Bytes32,
  type EvmAddress,
  type IsoTimestamp,
  type RedemptionRequestId,
  type TransactionHash,
} from "@harbor/shared";
import type { Abi as ViemAbi, Address } from "viem";

import type { SqliteDatabase } from "../db/index.js";
import {
  getRedemptionEvent,
  getRedemption,
  insertRedemptionEvent,
  upsertRedemption,
  updateRedemptionStatus,
} from "../repositories/redemptions.js";
import {
  getSyncCursor,
  upsertSyncCursor,
} from "../repositories/syncCursors.js";

export const indexedAssetManagerEventNames = [
  "RedemptionRequested",
  "RedemptionWithTagRequested",
  "RedemptionPerformed",
  "RedemptionDefault",
  "RedemptionTicketCreated",
  "RedemptionTicketUpdated",
] as const;

export const indexedHarborRedeemerEventNames = [
  "DefaultKeeperExecutorUpdated",
  "OwnershipTransferred",
  "RedemptionDefaultForwarded",
] as const;

const redemptionDefaultEventAliases = new Set([
  "RedemptionDefault",
  "RedemptionDefaulted",
]);

export type IndexedAssetManagerEventName =
  (typeof indexedAssetManagerEventNames)[number];
export type IndexedHarborRedeemerEventName =
  (typeof indexedHarborRedeemerEventNames)[number];
export type IndexedRedemptionEventName =
  | IndexedAssetManagerEventName
  | IndexedHarborRedeemerEventName
  | "RedemptionDefaulted";

export type ViemDecodedEventLog = Readonly<{
  address: EvmAddress;
  blockNumber: bigint | null;
  logIndex: number | bigint | null;
  transactionHash: TransactionHash | null;
  transactionIndex?: number | bigint | null;
  eventName: string;
  args: unknown;
}>;

export type ViemEventClient = Readonly<{
  getContractEvents(parameters: {
    address: Address;
    abi: ViemAbi;
    fromBlock: bigint;
    toBlock: bigint;
    strict: true;
  }): Promise<readonly ViemDecodedEventLog[]>;
  watchContractEvent(parameters: {
    address: Address;
    abi: ViemAbi;
    strict: true;
    onLogs(logs: readonly ViemDecodedEventLog[]): void;
    onError?(error: Error): void;
  }): () => void;
}>;

export type FAssetIndexerConfig = Readonly<{
  database: SqliteDatabase;
  chainId: string;
  assetManagerAddress: EvmAddress;
  harborRedeemerAddress?: EvmAddress;
  observedAt?: IsoTimestamp;
}>;

export type IndexFAssetEventLogsInput = FAssetIndexerConfig &
  Readonly<{
    logs: readonly ViemDecodedEventLog[];
  }>;

export type BackfillFAssetEventsInput = FAssetIndexerConfig &
  Readonly<{
    publicClient: ViemEventClient;
    fromBlock: bigint;
    toBlock: bigint;
    chunkSize?: bigint;
    cursorName?: string;
  }>;

export type WatchFAssetEventsInput = FAssetIndexerConfig &
  Readonly<{
    publicClient: ViemEventClient;
    onError?(error: Error): void;
  }>;

export type FAssetIndexingSummary = Readonly<{
  logsProcessed: number;
  redemptionRequestsIndexed: number;
  statusUpdatesIndexed: number;
  metadataEventsIndexed: number;
  unsupportedEventsIndexed: number;
  missingRedemptionsForStatusEvents: number;
}>;

type MutableFAssetIndexingSummary = {
  -readonly [Key in keyof FAssetIndexingSummary]: FAssetIndexingSummary[Key];
};

type MinedLogIdentity = Readonly<{
  contractAddress: EvmAddress;
  blockNumber: string;
  logIndex: string;
  transactionHash: TransactionHash;
  transactionIndex: string | null;
}>;

const defaultBackfillChunkSize = 2_000n;
const assetManagerIndexerAbi = selectEventFragments(
  assetManagerEventsAbi,
  new Set<string>(indexedAssetManagerEventNames),
);
const harborRedeemerIndexerAbi = selectEventFragments(
  harborRedeemerAbi,
  new Set<string>(indexedHarborRedeemerEventNames),
);

function selectEventFragments(
  abi: ProtocolAbi,
  eventNames: ReadonlySet<string>,
): ViemAbi {
  return abi.filter(
    (fragment) => fragment.type === "event" && eventNames.has(fragment.name),
  ) as unknown as ViemAbi;
}

function createEmptySummary(): MutableFAssetIndexingSummary {
  return {
    logsProcessed: 0,
    redemptionRequestsIndexed: 0,
    statusUpdatesIndexed: 0,
    metadataEventsIndexed: 0,
    unsupportedEventsIndexed: 0,
    missingRedemptionsForStatusEvents: 0,
  };
}

function addSummary(
  target: MutableFAssetIndexingSummary,
  source: FAssetIndexingSummary,
): void {
  target.logsProcessed += source.logsProcessed;
  target.redemptionRequestsIndexed += source.redemptionRequestsIndexed;
  target.statusUpdatesIndexed += source.statusUpdatesIndexed;
  target.metadataEventsIndexed += source.metadataEventsIndexed;
  target.unsupportedEventsIndexed += source.unsupportedEventsIndexed;
  target.missingRedemptionsForStatusEvents +=
    source.missingRedemptionsForStatusEvents;
}

function decimalString(value: number | bigint, fieldName: string): string {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${fieldName} cannot be negative`);
    }

    return value.toString();
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }

  return value.toString();
}

function decimalBigint(value: unknown, fieldName: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${fieldName} cannot be negative`);
    }

    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  throw new Error(`${fieldName} must be a non-negative integer`);
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }

  return value;
}

function requireRecord(
  value: unknown,
  eventName: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${eventName} log args must be a decoded object`);
  }

  return value as Record<string, unknown>;
}

function evmAddressArg(
  args: Record<string, unknown>,
  fieldName: string,
): EvmAddress {
  return normalizeEvmAddress(requireString(args[fieldName], fieldName));
}

function bytes32Arg(args: Record<string, unknown>, fieldName: string): Bytes32 {
  return normalizeBytes32(requireString(args[fieldName], fieldName));
}

function transactionHashArg(
  args: Record<string, unknown>,
  fieldName: string,
): TransactionHash {
  return normalizeTransactionHash(requireString(args[fieldName], fieldName));
}

function requestIdArg(
  args: Record<string, unknown>,
  fieldName = "requestId",
): RedemptionRequestId {
  return normalizeRequestId(decimalBigint(args[fieldName], fieldName));
}

function stringArg(args: Record<string, unknown>, fieldName: string): string {
  return requireString(args[fieldName], fieldName);
}

function bigintArg(args: Record<string, unknown>, fieldName: string): bigint {
  return decimalBigint(args[fieldName], fieldName);
}

function serializePayloadValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(serializePayloadValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        serializePayloadValue(entry),
      ]),
    );
  }

  return value;
}

function getMinedLogIdentity(log: ViemDecodedEventLog): MinedLogIdentity {
  if (log.blockNumber === null) {
    throw new Error(`${log.eventName} log is missing blockNumber`);
  }

  if (log.logIndex === null) {
    throw new Error(`${log.eventName} log is missing logIndex`);
  }

  if (log.transactionHash === null) {
    throw new Error(`${log.eventName} log is missing transactionHash`);
  }

  return {
    contractAddress: normalizeEvmAddress(log.address),
    blockNumber: decimalString(log.blockNumber, "blockNumber"),
    logIndex: decimalString(log.logIndex, "logIndex"),
    transactionHash: normalizeTransactionHash(log.transactionHash),
    transactionIndex:
      log.transactionIndex === undefined || log.transactionIndex === null
        ? null
        : decimalString(log.transactionIndex, "transactionIndex"),
  };
}

function compareLogs(first: ViemDecodedEventLog, second: ViemDecodedEventLog) {
  const firstBlock = decimalBigint(first.blockNumber, "blockNumber");
  const secondBlock = decimalBigint(second.blockNumber, "blockNumber");
  if (firstBlock !== secondBlock) {
    return firstBlock < secondBlock ? -1 : 1;
  }

  const firstLogIndex = decimalBigint(first.logIndex, "logIndex");
  const secondLogIndex = decimalBigint(second.logIndex, "logIndex");
  if (firstLogIndex === secondLogIndex) {
    return 0;
  }

  return firstLogIndex < secondLogIndex ? -1 : 1;
}

function insertObservedEvent(
  input: FAssetIndexerConfig,
  log: ViemDecodedEventLog,
  identity: MinedLogIdentity,
  details: Readonly<{
    assetManagerAddress: EvmAddress | null;
    requestId: RedemptionRequestId | null;
    agentVault: EvmAddress | null;
    redeemer: EvmAddress | null;
    payload: unknown;
  }>,
): void {
  insertRedemptionEvent(input.database, {
    chainId: input.chainId,
    contractAddress: identity.contractAddress,
    blockNumber: identity.blockNumber,
    logIndex: identity.logIndex,
    transactionHash: identity.transactionHash,
    transactionIndex: identity.transactionIndex,
    eventName: log.eventName,
    assetManagerAddress: details.assetManagerAddress,
    requestId: details.requestId,
    agentVault: details.agentVault,
    redeemer: details.redeemer,
    payload: serializePayloadValue(details.payload),
    observedAt: input.observedAt ?? new Date().toISOString(),
  });
}

function getRedemptionRequestedFields(args: Record<string, unknown>) {
  return {
    agentVault: evmAddressArg(args, "agentVault"),
    redeemer: evmAddressArg(args, "redeemer"),
    requestId: requestIdArg(args),
    paymentAddress: stringArg(args, "paymentAddress"),
    valueUBA: bigintArg(args, "valueUBA"),
    feeUBA: bigintArg(args, "feeUBA"),
    firstUnderlyingBlock: bigintArg(args, "firstUnderlyingBlock"),
    lastUnderlyingBlock: bigintArg(args, "lastUnderlyingBlock"),
    lastUnderlyingTimestamp: bigintArg(args, "lastUnderlyingTimestamp"),
    paymentReference: bytes32Arg(args, "paymentReference"),
    executor: evmAddressArg(args, "executor"),
    executorFeeNatWei: bigintArg(args, "executorFeeNatWei"),
  };
}

function processRedemptionRequested(
  input: FAssetIndexerConfig,
  log: ViemDecodedEventLog,
  identity: MinedLogIdentity,
  summary: MutableFAssetIndexingSummary,
): void {
  const args = requireRecord(log.args, log.eventName);
  const fields = getRedemptionRequestedFields(args);
  const assetManagerAddress = normalizeEvmAddress(input.assetManagerAddress);

  insertObservedEvent(input, log, identity, {
    assetManagerAddress,
    requestId: fields.requestId,
    agentVault: fields.agentVault,
    redeemer: fields.redeemer,
    payload: fields,
  });

  upsertRedemption(input.database, {
    assetManagerAddress,
    requestId: fields.requestId,
    sourceChainId: input.chainId,
    sourceBlockNumber: identity.blockNumber,
    sourceLogIndex: identity.logIndex,
    sourceTransactionHash: identity.transactionHash,
    redeemer: fields.redeemer,
    agentVault: fields.agentVault,
    paymentAddress: fields.paymentAddress,
    valueUBA: fields.valueUBA,
    feeUBA: fields.feeUBA,
    paymentReference: fields.paymentReference,
    firstUnderlyingBlock: fields.firstUnderlyingBlock,
    lastUnderlyingBlock: fields.lastUnderlyingBlock,
    lastUnderlyingTimestamp: fields.lastUnderlyingTimestamp,
    executor: fields.executor,
    executorFeeNatWei: fields.executorFeeNatWei,
    status: "REQUESTED",
  });

  summary.redemptionRequestsIndexed += 1;
}

function processRedemptionWithTagRequested(
  input: FAssetIndexerConfig,
  log: ViemDecodedEventLog,
  identity: MinedLogIdentity,
  summary: MutableFAssetIndexingSummary,
): void {
  const args = requireRecord(log.args, log.eventName);
  const fields = {
    ...getRedemptionRequestedFields(args),
    destinationTag: bigintArg(args, "destinationTag"),
    unsupportedReason: "redemption-with-tag-not-supported-in-mvp",
  };

  insertObservedEvent(input, log, identity, {
    assetManagerAddress: normalizeEvmAddress(input.assetManagerAddress),
    requestId: fields.requestId,
    agentVault: fields.agentVault,
    redeemer: fields.redeemer,
    payload: fields,
  });

  summary.unsupportedEventsIndexed += 1;
}

function processRedemptionPerformed(
  input: FAssetIndexerConfig,
  log: ViemDecodedEventLog,
  identity: MinedLogIdentity,
  summary: MutableFAssetIndexingSummary,
): void {
  const args = requireRecord(log.args, log.eventName);
  const assetManagerAddress = normalizeEvmAddress(input.assetManagerAddress);
  const requestId = requestIdArg(args);
  const agentVault = evmAddressArg(args, "agentVault");
  const redeemer = evmAddressArg(args, "redeemer");

  insertObservedEvent(input, log, identity, {
    assetManagerAddress,
    requestId,
    agentVault,
    redeemer,
    payload: {
      agentVault,
      redeemer,
      requestId,
      transactionHash: transactionHashArg(args, "transactionHash"),
      redemptionAmountUBA: bigintArg(args, "redemptionAmountUBA"),
      spentUnderlyingUBA: args.spentUnderlyingUBA,
    },
  });

  if (
    getRedemption(input.database, { assetManagerAddress, requestId }) === null
  ) {
    summary.missingRedemptionsForStatusEvents += 1;
    return;
  }

  updateRedemptionStatus(input.database, {
    assetManagerAddress,
    requestId,
    status: "SETTLED",
    transactionHash: transactionHashArg(args, "transactionHash"),
    statusReason: "redemption-performed",
  });
  summary.statusUpdatesIndexed += 1;
}

function processRedemptionDefault(
  input: FAssetIndexerConfig,
  log: ViemDecodedEventLog,
  identity: MinedLogIdentity,
  summary: MutableFAssetIndexingSummary,
): void {
  const args = requireRecord(log.args, log.eventName);
  const assetManagerAddress = normalizeEvmAddress(input.assetManagerAddress);
  const requestId = requestIdArg(args);
  const agentVault = evmAddressArg(args, "agentVault");
  const redeemer = evmAddressArg(args, "redeemer");

  insertObservedEvent(input, log, identity, {
    assetManagerAddress,
    requestId,
    agentVault,
    redeemer,
    payload: {
      agentVault,
      redeemer,
      requestId,
      redemptionAmountUBA: bigintArg(args, "redemptionAmountUBA"),
      redeemedVaultCollateralWei: bigintArg(args, "redeemedVaultCollateralWei"),
      redeemedPoolCollateralWei: bigintArg(args, "redeemedPoolCollateralWei"),
    },
  });

  if (
    getRedemption(input.database, { assetManagerAddress, requestId }) === null
  ) {
    summary.missingRedemptionsForStatusEvents += 1;
    return;
  }

  updateRedemptionStatus(input.database, {
    assetManagerAddress,
    requestId,
    status: "RECOVERED",
    defaultTransactionHash: identity.transactionHash,
    statusReason: "redemption-defaulted",
  });
  summary.statusUpdatesIndexed += 1;
}

function processTicketEvent(
  input: FAssetIndexerConfig,
  log: ViemDecodedEventLog,
  identity: MinedLogIdentity,
  summary: MutableFAssetIndexingSummary,
): void {
  const args = requireRecord(log.args, log.eventName);
  const agentVault = evmAddressArg(args, "agentVault");

  insertObservedEvent(input, log, identity, {
    assetManagerAddress: normalizeEvmAddress(input.assetManagerAddress),
    requestId: null,
    agentVault,
    redeemer: null,
    payload: {
      agentVault,
      redemptionTicketId: requestIdArg(args, "redemptionTicketId"),
      ticketValueUBA:
        args.ticketValueUBA === undefined
          ? undefined
          : bigintArg(args, "ticketValueUBA"),
    },
  });

  summary.metadataEventsIndexed += 1;
}

function processHarborEvent(
  input: FAssetIndexerConfig,
  log: ViemDecodedEventLog,
  identity: MinedLogIdentity,
  summary: MutableFAssetIndexingSummary,
): void {
  const args = requireRecord(log.args, log.eventName);
  const assetManagerAddress = normalizeEvmAddress(input.assetManagerAddress);
  const requestId =
    log.eventName === "RedemptionDefaultForwarded"
      ? requestIdArg(args, "redemptionRequestId")
      : null;

  insertObservedEvent(input, log, identity, {
    assetManagerAddress,
    requestId,
    agentVault: null,
    redeemer: null,
    payload: {
      ...args,
      harborRedeemerAddress: identity.contractAddress,
    },
  });

  summary.metadataEventsIndexed += 1;
}

function processLog(
  input: FAssetIndexerConfig,
  log: ViemDecodedEventLog,
  summary: MutableFAssetIndexingSummary,
): void {
  const identity = getMinedLogIdentity(log);
  summary.logsProcessed += 1;

  if (
    getRedemptionEvent(input.database, {
      chainId: input.chainId,
      blockNumber: identity.blockNumber,
      logIndex: identity.logIndex,
    }) !== null
  ) {
    return;
  }

  switch (log.eventName) {
    case "RedemptionRequested":
      processRedemptionRequested(input, log, identity, summary);
      return;
    case "RedemptionWithTagRequested":
      processRedemptionWithTagRequested(input, log, identity, summary);
      return;
    case "RedemptionPerformed":
      processRedemptionPerformed(input, log, identity, summary);
      return;
    case "RedemptionTicketCreated":
    case "RedemptionTicketUpdated":
      processTicketEvent(input, log, identity, summary);
      return;
    case "DefaultKeeperExecutorUpdated":
    case "OwnershipTransferred":
    case "RedemptionDefaultForwarded":
      processHarborEvent(input, log, identity, summary);
      return;
    default:
      if (redemptionDefaultEventAliases.has(log.eventName)) {
        processRedemptionDefault(input, log, identity, summary);
      }
  }
}

export function indexFAssetEventLogs(
  input: IndexFAssetEventLogsInput,
): FAssetIndexingSummary {
  const sortedLogs = [...input.logs].sort(compareLogs);
  const processLogs = input.database.transaction(
    (logs: readonly ViemDecodedEventLog[]): FAssetIndexingSummary => {
      const summary = createEmptySummary();

      for (const log of logs) {
        processLog(input, log, summary);
      }

      return summary;
    },
  );

  return processLogs(sortedLogs);
}

export function buildFAssetIndexerCursorName(
  chainId: string,
  assetManagerAddress: EvmAddress,
): string {
  return `fassets-events:${chainId}:${normalizeEvmAddress(assetManagerAddress)}`;
}

function getResumeBlock(input: BackfillFAssetEventsInput): bigint {
  const cursor = getSyncCursor(
    input.database,
    input.cursorName ??
      buildFAssetIndexerCursorName(input.chainId, input.assetManagerAddress),
  );

  if (cursor === null) {
    return input.fromBlock;
  }

  if (cursor.chainId !== null && cursor.chainId !== input.chainId) {
    throw new Error(
      `Cursor ${cursor.cursorName} belongs to chain ${cursor.chainId}, not ${input.chainId}`,
    );
  }

  const cursorBlock = decimalBigint(cursor.blockNumber, "cursor.blockNumber");
  if (cursorBlock < input.fromBlock) {
    return input.fromBlock;
  }

  return cursorBlock + 1n;
}

function buildBackfillCursorPayload(
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
): string {
  return JSON.stringify({
    mode: "backfill",
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    chunkSize: chunkSize.toString(),
  });
}

async function fetchLogsForRange(
  publicClient: ViemEventClient,
  address: EvmAddress,
  abi: ViemAbi,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<readonly ViemDecodedEventLog[]> {
  return publicClient.getContractEvents({
    address: normalizeEvmAddress(address) as Address,
    abi,
    fromBlock,
    toBlock,
    strict: true,
  });
}

export async function backfillFAssetEvents(
  input: BackfillFAssetEventsInput,
): Promise<FAssetIndexingSummary> {
  if (input.fromBlock > input.toBlock) {
    throw new Error("fromBlock must be less than or equal to toBlock");
  }

  const chunkSize = input.chunkSize ?? defaultBackfillChunkSize;
  if (chunkSize <= 0n) {
    throw new Error("chunkSize must be greater than zero");
  }

  const cursorName =
    input.cursorName ??
    buildFAssetIndexerCursorName(input.chainId, input.assetManagerAddress);
  const summary = createEmptySummary();
  let fromBlock = getResumeBlock(input);

  while (fromBlock <= input.toBlock) {
    const toBlock =
      fromBlock + chunkSize - 1n > input.toBlock
        ? input.toBlock
        : fromBlock + chunkSize - 1n;
    const assetManagerLogs = await fetchLogsForRange(
      input.publicClient,
      input.assetManagerAddress,
      assetManagerIndexerAbi,
      fromBlock,
      toBlock,
    );
    const harborLogs =
      input.harborRedeemerAddress === undefined
        ? []
        : await fetchLogsForRange(
            input.publicClient,
            input.harborRedeemerAddress,
            harborRedeemerIndexerAbi,
            fromBlock,
            toBlock,
          );

    const chunkSummary = indexFAssetEventLogs({
      ...input,
      logs: [...assetManagerLogs, ...harborLogs],
    });
    addSummary(summary, chunkSummary);

    upsertSyncCursor(input.database, {
      cursorName,
      chainId: input.chainId,
      blockNumber: toBlock.toString(),
      logIndex: null,
      payloadJson: buildBackfillCursorPayload(
        input.fromBlock,
        input.toBlock,
        chunkSize,
      ),
    });

    fromBlock = toBlock + 1n;
  }

  return summary;
}

export function watchFAssetEvents(input: WatchFAssetEventsInput): () => void {
  const unwatchAssetManager = input.publicClient.watchContractEvent({
    address: normalizeEvmAddress(input.assetManagerAddress) as Address,
    abi: assetManagerIndexerAbi,
    strict: true,
    onLogs: (logs) => {
      indexFAssetEventLogs({ ...input, logs });
    },
    ...(input.onError === undefined ? {} : { onError: input.onError }),
  });
  const unwatchHarborRedeemer =
    input.harborRedeemerAddress === undefined
      ? undefined
      : input.publicClient.watchContractEvent({
          address: normalizeEvmAddress(input.harborRedeemerAddress) as Address,
          abi: harborRedeemerIndexerAbi,
          strict: true,
          onLogs: (logs) => {
            indexFAssetEventLogs({ ...input, logs });
          },
          ...(input.onError === undefined ? {} : { onError: input.onError }),
        });

  return () => {
    unwatchAssetManager();
    unwatchHarborRedeemer?.();
  };
}
