import {
  coston2Chain,
  coston2RelayAddress,
  type EvmAddress,
} from "@harbor/protocol";
import {
  normalizeBytes32,
  normalizeEvmAddress,
  serializeBigints,
  type Bytes32,
} from "@harbor/shared";
import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { openSqliteDatabase, runMigrations } from "../db/index.js";
import { zeroBytes32 } from "../fdc/referencedPaymentNonexistence.js";
import {
  createHarborRedeemerDefaultExecutor,
  type HarborDefaultPublicClient,
  type HarborDefaultWalletClient,
} from "./defaultExecutor.js";
import {
  createSqliteKeeperFdcClient,
  createSqliteKeeperRepository,
} from "./sqliteAdapters.js";
import {
  defaultKeeperBatchSize,
  defaultKeeperPollingIntervalMs,
  runKeeperBatch,
  runKeeperLoop,
  type KeeperLogEvent,
} from "./stateMachine.js";

type KeeperCommand = "once" | "run";

const defaultDatabaseLocation = "./data/harbor.sqlite";

function usage(): string {
  return [
    "Usage: node dist/keeper/cli.js <once|run> [options]",
    "",
    "Options:",
    "  --database <path-or-file-url>          Defaults to INDEXER_DB_URL or ./data/harbor.sqlite",
    "  --rpc-url <url>                        Defaults to RPC_URL_COSTON2 or the pinned Coston2 RPC",
    "  --harbor-redeemer <address>            Defaults to HARBOR_REDEEMER_ADDRESS",
    "  --keeper-private-key <0x...>           Defaults to KEEPER_PRIVATE_KEY",
    "  --fdc-da-layer-url <url>               Defaults to FDC_DA_LAYER_URL or the pinned Coston2 DA API",
    "  --fdc-da-layer-api-key <key>           Defaults to FDC_DA_LAYER_API_KEY",
    "  --message-integrity-code <bytes32>     Defaults to HARBOR_FDC_MESSAGE_INTEGRITY_CODE or zero bytes32",
    "  --batch-size <count>                   Defaults to HARBOR_KEEPER_BATCH_SIZE or 25",
    "  --polling-interval-ms <milliseconds>   Defaults to HARBOR_KEEPER_POLL_INTERVAL_MS or 30000",
  ].join("\n");
}

function parseCommand(value: string | undefined): KeeperCommand {
  if (value === "once" || value === "run") {
    return value;
  }

  throw new Error(usage());
}

function parseFlagValue(
  args: readonly string[],
  names: readonly string[],
): string | undefined {
  const flagIndex = args.findIndex((arg) => names.includes(arg));

  if (flagIndex < 0) {
    return undefined;
  }

  const value = args[flagIndex + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${names[0]} requires a value`);
  }

  return value;
}

function requiredValue(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }

  return value;
}

function parsePositiveInteger(
  value: string | undefined,
  defaultValue: number,
  flagName: string,
): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive safe integer`);
  }

  return parsed;
}

function createJsonLogger() {
  const write = (level: string, event: KeeperLogEvent): void => {
    console.log(
      JSON.stringify(
        serializeBigints({
          level,
          timestamp: new Date().toISOString(),
          ...event,
        }),
      ),
    );
  };

  return {
    info: (event: KeeperLogEvent) => write("info", event),
    warn: (event: KeeperLogEvent) => write("warn", event),
    error: (event: KeeperLogEvent) => write("error", event),
  };
}

async function main(): Promise<void> {
  const [, , commandValue, ...args] = process.argv;
  const command = parseCommand(commandValue);
  const databaseLocation =
    parseFlagValue(args, ["--database", "--db"]) ??
    process.env.INDEXER_DB_URL ??
    defaultDatabaseLocation;
  const rpcUrl =
    parseFlagValue(args, ["--rpc-url"]) ??
    process.env.RPC_URL_COSTON2 ??
    coston2Chain.rpcUrls.default.http[0];
  const harborRedeemerAddress = normalizeEvmAddress(
    requiredValue(
      parseFlagValue(args, ["--harbor-redeemer"]) ??
        process.env.HARBOR_REDEEMER_ADDRESS,
      "HARBOR_REDEEMER_ADDRESS",
    ),
  );
  const keeperPrivateKey = requiredValue(
    parseFlagValue(args, ["--keeper-private-key"]) ??
      process.env.KEEPER_PRIVATE_KEY,
    "KEEPER_PRIVATE_KEY",
  ) as `0x${string}`;
  const messageIntegrityCode = normalizeBytes32(
    parseFlagValue(args, ["--message-integrity-code"]) ??
      process.env.HARBOR_FDC_MESSAGE_INTEGRITY_CODE ??
      zeroBytes32,
  ) as Bytes32;
  const daLayerBaseUrl =
    parseFlagValue(args, ["--fdc-da-layer-url"]) ??
    process.env.FDC_DA_LAYER_URL;
  const daLayerApiKey =
    parseFlagValue(args, ["--fdc-da-layer-api-key"]) ??
    process.env.FDC_DA_LAYER_API_KEY;
  const batchSize = parsePositiveInteger(
    parseFlagValue(args, ["--batch-size"]) ??
      process.env.HARBOR_KEEPER_BATCH_SIZE,
    defaultKeeperBatchSize,
    "--batch-size",
  );
  const pollingIntervalMs = parsePositiveInteger(
    parseFlagValue(args, ["--polling-interval-ms"]) ??
      process.env.HARBOR_KEEPER_POLL_INTERVAL_MS,
    defaultKeeperPollingIntervalMs,
    "--polling-interval-ms",
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
  const database = openSqliteDatabase(databaseLocation);

  try {
    runMigrations(database);

    const repository = createSqliteKeeperRepository(database);
    const fdcClient = createSqliteKeeperFdcClient({
      database,
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
    const logger = createJsonLogger();

    if (command === "once") {
      const summary = await runKeeperBatch({
        repository,
        fdcClient,
        defaultExecutor,
        logger,
        batchSize,
      });
      console.log(JSON.stringify(serializeBigints(summary), null, 2));
      return;
    }

    await runKeeperLoop({
      repository,
      fdcClient,
      defaultExecutor,
      logger,
      batchSize,
      pollingIntervalMs,
    });
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
