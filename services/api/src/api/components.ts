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
import type {
  ComponentContext,
  ComponentHandle,
  ServiceComponentStarters,
} from "./startup.js";

const defaultAgentRefreshIntervalMs = 300_000;

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next === undefined || next === "" ? undefined : next;
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
  const { config } = context;
  const publicClient = createPublicClient({
    chain: coston2Chain as Chain,
    transport: http(resolveRpcUrl(context)),
  });
  const harborRedeemerAddress = trimmed(context.env["HARBOR_REDEEMER_ADDRESS"]);

  const unwatch = watchFAssetEvents({
    database: context.database,
    chainId: config.api.chainId,
    assetManagerAddress: config.api.assetManagerAddress,
    ...(harborRedeemerAddress === undefined
      ? {}
      : { harborRedeemerAddress: normalizeEvmAddress(harborRedeemerAddress) }),
    publicClient: publicClient as unknown as ViemEventClient,
    onError: (error) =>
      context.logger.error("indexer watch error", {
        error: errorMessage(error),
      }),
  });

  return {
    name: "indexer",
    stop: () => {
      unwatch();
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

/**
 * Real, env-driven starters for the optional long-running components. They
 * construct network clients only when the matching flag is enabled, so the
 * default API-only local workflow never touches the network.
 */
export const defaultComponentStarters: Required<ServiceComponentStarters> = {
  indexer: startIndexerComponent,
  agentRefresh: startAgentRefreshComponent,
  keeper: startKeeperComponent,
};
