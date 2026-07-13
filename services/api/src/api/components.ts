import {
  coston2Chain,
  coston2FtsoV2Address,
  coston2RelayAddress,
} from "@harbor/protocol";
import {
  normalizeBytes32,
  normalizeEvmAddress,
  type Bytes32,
  type EvmAddress,
} from "@harbor/shared";
import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { zeroBytes32 } from "../fdc/referencedPaymentNonexistence.js";
import {
  backfillFAssetEvents,
  defaultAgentInventoryPageSize,
  refreshAgentInventory,
  watchFAssetEvents,
  type ViemEventClient,
  type ViemReadContractClient,
} from "../indexer/index.js";
import {
  createHarborRedeemerDefaultExecutor,
  createSqliteKeeperFdcClient,
  createSqliteKeeperRepository,
  defaultKeeperBatchSize,
  defaultKeeperPollingIntervalMs,
  runKeeperLoop,
  type HarborDefaultPublicClient,
  type HarborDefaultWalletClient,
} from "../keeper/index.js";
import { refreshAgentReliabilityScores } from "../scoring/agentReliability.js";
import {
  defaultFtsoMaxAgeSeconds,
  type FtsoReadContractClient,
} from "../scoring/ftsoPrices.js";
import {
  backfillRedemptionXrplPayments,
  defaultXrplTestnetEndpoint,
  RetryingXrplClient,
} from "../xrpl/index.js";
import type {
  ComponentContext,
  ComponentHandle,
  ServiceComponentStarters,
} from "./startup.js";

const defaultAgentRefreshIntervalMs = 300_000;

/**
 * Indexer reconciliation defaults. The public Coston2 RPC rejects any
 * `eth_getLogs` request spanning more than 30 blocks, so the backfill range is
 * capped at 30 by default. The reconciler re-runs on this cadence and advances
 * the persisted sync cursor, so on-chain events emitted while the live watcher
 * was disconnected (restart, redeploy, RPC gap) are recovered instead of lost.
 */
const defaultIndexerMaxBlockRange = 30n;
const defaultIndexerPollIntervalMs = 10_000;
const defaultIndexerStartLookback = 5_000n;

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next === undefined || next === "" ? undefined : next;
}

function parseOptionalBigint(
  value: string | undefined,
  name: string,
): bigint | undefined {
  const raw = trimmed(value);

  if (raw === undefined) {
    return undefined;
  }

  let parsed: bigint;
  try {
    parsed = BigInt(raw);
  } catch {
    throw new Error(
      `${name} must be a non-negative integer, received "${raw}"`,
    );
  }

  if (parsed < 0n) {
    throw new Error(
      `${name} must be a non-negative integer, received "${raw}"`,
    );
  }

  return parsed;
}

function parseBooleanFlag(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  const raw = trimmed(value)?.toLowerCase();

  if (raw === undefined) {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }

  throw new Error(
    `Expected a boolean value (true/false), received "${value ?? ""}"`,
  );
}

function required(value: string | undefined, name: string): string {
  const next = trimmed(value);

  if (next === undefined) {
    throw new Error(`${name} is required to start this component`);
  }

  return next;
}

function parsePositiveInteger(
  value: string | undefined,
  defaultValue: number,
  name: string,
): number {
  const raw = trimmed(value);

  if (raw === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}"`);
  }

  return parsed;
}

function resolveRpcUrl(context: ComponentContext): string {
  return (
    trimmed(context.env["RPC_URL_COSTON2"]) ??
    coston2Chain.rpcUrls.default.http[0]
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Repeatedly run `task` spaced by `intervalMs`, starting immediately. Uses a
 * self-rescheduling timer (never `setInterval`) so a slow run can't overlap the
 * next, and returns a stop function that prevents further runs.
 */
function startPollingTask(
  intervalMs: number,
  task: () => Promise<void>,
  onError: (error: unknown) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = async (): Promise<void> => {
    if (stopped) {
      return;
    }

    try {
      await task();
    } catch (error) {
      onError(error);
    }

    if (!stopped) {
      timer = setTimeout(() => void run(), intervalMs);
    }
  };

  void run();

  return () => {
    stopped = true;

    if (timer !== null) {
      clearTimeout(timer);
    }
  };
}

function startIndexerComponent(context: ComponentContext): ComponentHandle {
  const { config, env } = context;
  const publicClient = createPublicClient({
    chain: coston2Chain as Chain,
    transport: http(resolveRpcUrl(context)),
  });
  const harborRedeemerAddress = trimmed(env["HARBOR_REDEEMER_ADDRESS"]);
  const normalizedHarborRedeemer =
    harborRedeemerAddress === undefined
      ? undefined
      : normalizeEvmAddress(harborRedeemerAddress);

  const startBlock = parseOptionalBigint(
    env["HARBOR_INDEXER_START_BLOCK"],
    "HARBOR_INDEXER_START_BLOCK",
  );
  const startLookback =
    parseOptionalBigint(
      env["HARBOR_INDEXER_START_LOOKBACK"],
      "HARBOR_INDEXER_START_LOOKBACK",
    ) ?? defaultIndexerStartLookback;
  const maxBlockRange =
    parseOptionalBigint(
      env["HARBOR_INDEXER_MAX_BLOCK_RANGE"],
      "HARBOR_INDEXER_MAX_BLOCK_RANGE",
    ) ?? defaultIndexerMaxBlockRange;

  if (maxBlockRange <= 0n) {
    throw new Error("HARBOR_INDEXER_MAX_BLOCK_RANGE must be greater than zero");
  }

  const pollIntervalMs = parsePositiveInteger(
    env["HARBOR_INDEXER_POLL_INTERVAL_MS"],
    defaultIndexerPollIntervalMs,
    "HARBOR_INDEXER_POLL_INTERVAL_MS",
  );
  const watchEnabled = parseBooleanFlag(env["HARBOR_INDEXER_WATCH"], true);

  const eventClient = publicClient as unknown as ViemEventClient;

  // Stable floor for the very first backfill (before any cursor exists). Cached
  // so a growing chain head can never advance the floor past the persisted
  // cursor and skip blocks; once a cursor exists, backfill resumes from it.
  let resolvedFromBlock: bigint | undefined;

  const reconcile = async (): Promise<void> => {
    const head = await publicClient.getBlockNumber();

    if (resolvedFromBlock === undefined) {
      resolvedFromBlock =
        startBlock ?? (head > startLookback ? head - startLookback : 0n);
    }

    if (resolvedFromBlock > head) {
      return;
    }

    const summary = await backfillFAssetEvents({
      database: context.database,
      chainId: config.api.chainId,
      assetManagerAddress: config.api.assetManagerAddress,
      ...(normalizedHarborRedeemer === undefined
        ? {}
        : { harborRedeemerAddress: normalizedHarborRedeemer }),
      publicClient: eventClient,
      fromBlock: resolvedFromBlock,
      toBlock: head,
      chunkSize: maxBlockRange,
    });

    if (
      summary.redemptionRequestsIndexed > 0 ||
      summary.statusUpdatesIndexed > 0
    ) {
      context.logger.info("indexer reconciled", {
        toBlock: head.toString(),
        redemptionRequestsIndexed: summary.redemptionRequestsIndexed,
        statusUpdatesIndexed: summary.statusUpdatesIndexed,
      });
    }
  };

  // Durable catch-up: runs immediately, then on a poll cadence. Every pass
  // resumes from the persisted cursor in <= maxBlockRange chunks and advances
  // it, so a restart/redeploy/RPC gap can no longer strand a redemption.
  const stopReconciler = startPollingTask(pollIntervalMs, reconcile, (error) =>
    context.logger.error("indexer reconcile error", {
      error: errorMessage(error),
    }),
  );

  // Optional low-latency live watch on top of the reconciler. Indexing is
  // idempotent (events dedupe by chain/block/logIndex), so overlap is safe.
  const unwatch = watchEnabled
    ? watchFAssetEvents({
        database: context.database,
        chainId: config.api.chainId,
        assetManagerAddress: config.api.assetManagerAddress,
        ...(normalizedHarborRedeemer === undefined
          ? {}
          : { harborRedeemerAddress: normalizedHarborRedeemer }),
        publicClient: eventClient,
        onError: (error) =>
          context.logger.error("indexer watch error", {
            error: errorMessage(error),
          }),
      })
    : undefined;

  return {
    name: "indexer",
    stop: () => {
      stopReconciler();
      unwatch?.();
    },
  };
}

function startAgentRefreshComponent(
  context: ComponentContext,
): ComponentHandle {
  const { config } = context;
  const publicClient = createPublicClient({
    chain: coston2Chain as Chain,
    transport: http(resolveRpcUrl(context)),
  });
  const pageSize = parsePositiveInteger(
    context.env["HARBOR_AGENT_INVENTORY_PAGE_SIZE"],
    defaultAgentInventoryPageSize,
    "HARBOR_AGENT_INVENTORY_PAGE_SIZE",
  );
  const intervalMs = parsePositiveInteger(
    context.env["HARBOR_AGENT_REFRESH_INTERVAL_MS"],
    defaultAgentRefreshIntervalMs,
    "HARBOR_AGENT_REFRESH_INTERVAL_MS",
  );
  const maxFtsoAgeSeconds = parsePositiveInteger(
    context.env["HARBOR_FTSO_MAX_AGE_SECONDS"],
    defaultFtsoMaxAgeSeconds,
    "HARBOR_FTSO_MAX_AGE_SECONDS",
  );
  const ftsoV2Address = normalizeEvmAddress(
    trimmed(context.env["HARBOR_FTSO_V2_ADDRESS"]) ?? coston2FtsoV2Address,
  );

  const stop = startPollingTask(
    intervalMs,
    async () => {
      await refreshAgentInventory({
        database: context.database,
        publicClient: publicClient as unknown as ViemReadContractClient,
        assetManagerAddress: config.api.assetManagerAddress,
        pageSize,
      });
      await refreshAgentReliabilityScores({
        database: context.database,
        ftsoClient: publicClient as unknown as FtsoReadContractClient,
        ftsoV2Address,
        maxFtsoAgeSeconds,
      });
    },
    (error) =>
      context.logger.error("agent refresh error", {
        error: errorMessage(error),
      }),
  );

  return { name: "agentRefresh", stop };
}

function startKeeperComponent(context: ComponentContext): ComponentHandle {
  const { config, env } = context;
  const rpcUrl = resolveRpcUrl(context);
  const harborRedeemerAddress = normalizeEvmAddress(
    required(env["HARBOR_REDEEMER_ADDRESS"], "HARBOR_REDEEMER_ADDRESS"),
  );
  const keeperPrivateKey = required(
    env["KEEPER_PRIVATE_KEY"],
    "KEEPER_PRIVATE_KEY",
  ) as `0x${string}`;
  const messageIntegrityCode = normalizeBytes32(
    trimmed(env["HARBOR_FDC_MESSAGE_INTEGRITY_CODE"]) ?? zeroBytes32,
  ) as Bytes32;
  const daLayerBaseUrl = trimmed(env["FDC_DA_LAYER_URL"]);
  const daLayerApiKey = trimmed(env["FDC_DA_LAYER_API_KEY"]);
  const batchSize = parsePositiveInteger(
    env["HARBOR_KEEPER_BATCH_SIZE"],
    defaultKeeperBatchSize,
    "HARBOR_KEEPER_BATCH_SIZE",
  );
  const pollingIntervalMs = parsePositiveInteger(
    env["HARBOR_KEEPER_POLL_INTERVAL_MS"],
    defaultKeeperPollingIntervalMs,
    "HARBOR_KEEPER_POLL_INTERVAL_MS",
  );

  const account = privateKeyToAccount(keeperPrivateKey);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({
    chain: coston2Chain as Chain,
    transport,
  });
  const walletClient = createWalletClient({
    account,
    chain: coston2Chain as Chain,
    transport,
  });
  const repository = createSqliteKeeperRepository(context.database);
  const fdcClient = createSqliteKeeperFdcClient({
    database: context.database,
    messageIntegrityCode,
    publicClient,
    walletClient,
    relayAddress: coston2RelayAddress,
    ...(daLayerBaseUrl === undefined ? {} : { daLayerBaseUrl }),
    ...(daLayerApiKey === undefined ? {} : { daLayerApiKey }),
  });
  const defaultExecutor = createHarborRedeemerDefaultExecutor({
    harborRedeemerAddress,
    walletClient: walletClient as unknown as HarborDefaultWalletClient,
    publicClient: publicClient as unknown as HarborDefaultPublicClient,
    account: normalizeEvmAddress(account.address) as EvmAddress,
  });

  const abortController = new AbortController();

  void runKeeperLoop({
    repository,
    fdcClient,
    defaultExecutor,
    batchSize,
    pollingIntervalMs,
    signal: abortController.signal,
    logger: {
      info: (event) => context.logger.info("keeper", { ...event }),
      warn: (event) => context.logger.info("keeper", { ...event }),
      error: (event) => context.logger.error("keeper", { ...event }),
    },
  }).catch((error: unknown) =>
    context.logger.error("keeper loop crashed", {
      error: errorMessage(error),
    }),
  );

  return {
    name: "keeper",
    stop: () => {
      abortController.abort();
    },
  };
}

const defaultXrplObserverPollIntervalMs = 15_000;
const defaultXrplObserverBatchSize = 25;

/**
 * Non-terminal redemption statuses an agent XRPL payment can still settle. Once
 * a redemption is SETTLED/RECOVERED/FAILED it is excluded, so the observer never
 * races the on-chain indexer's settlement or the keeper's recovery track.
 */
const xrplObservableStatuses = [
  "REQUESTED",
  "WATCHING",
  "WINDOW_EXPIRED",
  "REQUEST_PROOF",
  "PROOF_READY",
] as const;

/**
 * Polls the XRPL underlying chain for agent payments to in-flight redemptions
 * and records a settlement receipt (marking the redemption SETTLED) as soon as
 * a matching payment is observed. This is what populates `xrplReceipts` and
 * gives Harbor a fast, XRPL-sourced settlement signal independent of the
 * on-chain RedemptionPerformed event.
 */
function startXrplObserverComponent(
  context: ComponentContext,
): ComponentHandle {
  const { env } = context;
  const endpoint = trimmed(env["XRPL_ENDPOINT"]) ?? defaultXrplTestnetEndpoint;
  const client = new RetryingXrplClient(endpoint);
  const repository = createSqliteKeeperRepository(context.database);
  const pollIntervalMs = parsePositiveInteger(
    env["HARBOR_XRPL_OBSERVER_POLL_INTERVAL_MS"],
    defaultXrplObserverPollIntervalMs,
    "HARBOR_XRPL_OBSERVER_POLL_INTERVAL_MS",
  );
  const batchSize = parsePositiveInteger(
    env["HARBOR_XRPL_OBSERVER_BATCH_SIZE"],
    defaultXrplObserverBatchSize,
    "HARBOR_XRPL_OBSERVER_BATCH_SIZE",
  );

  const stop = startPollingTask(
    pollIntervalMs,
    async () => {
      const redemptions = await repository.listEligibleRedemptions({
        statuses: xrplObservableStatuses,
        limit: batchSize,
      });

      for (const redemption of redemptions) {
        const summary = await backfillRedemptionXrplPayments({
          database: context.database,
          client,
          redemption,
        });

        if (
          summary.observationsPersisted > 0 ||
          summary.redemptionsSettled > 0
        ) {
          context.logger.info("xrpl payment observed", {
            requestId: redemption.requestId,
            observationsPersisted: summary.observationsPersisted,
            redemptionsSettled: summary.redemptionsSettled,
          });
        }
      }
    },
    (error) =>
      context.logger.error("xrpl observer error", {
        error: errorMessage(error),
      }),
  );

  return {
    name: "xrplObserver",
    stop: () => {
      stop();
    },
  };
}

/**
 * Real, env-driven starters for the optional long-running components. They
 * construct network clients only when the matching flag is enabled, so the
 * default API-only local workflow never touches the network.
 */
export const defaultComponentStarters: Required<ServiceComponentStarters> = {
  indexer: startIndexerComponent,
  xrplObserver: startXrplObserverComponent,
  agentRefresh: startAgentRefreshComponent,
  keeper: startKeeperComponent,
};
