import { coston2Chain, coston2FxrpAssetManagerAddress } from "@harbor/protocol";
import { normalizeEvmAddress, serializeBigints } from "@harbor/shared";
import { createPublicClient, http, type Chain } from "viem";

import { openSqliteDatabase, runMigrations } from "../db/index.js";
import {
  defaultAgentInventoryPageSize,
  refreshAgentInventory,
  type ViemReadContractClient,
} from "./agentInventory.js";

type AgentInventoryCommand = "refresh";

const defaultDatabaseLocation = "./data/harbor.sqlite";

function usage(): string {
  return [
    "Usage: node dist/indexer/agentInventoryCli.js refresh [options]",
    "",
    "Options:",
    "  --database <path-or-file-url>     Defaults to INDEXER_DB_URL or ./data/harbor.sqlite",
    "  --rpc-url <url>                   Defaults to RPC_URL_COSTON2 or the pinned Coston2 RPC",
    "  --asset-manager <address>         Defaults to the pinned Coston2 FXRP AssetManager",
    "  --page-size <count>               Defaults to HARBOR_AGENT_INVENTORY_PAGE_SIZE or 25",
    "  --available-only                  Skip getAllAgents and refresh currently available agents only",
  ].join("\n");
}

function parseCommand(value: string | undefined): AgentInventoryCommand {
  if (value === "refresh") {
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

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

function parsePageSize(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return defaultAgentInventoryPageSize;
  }

  const pageSize = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new Error("--page-size must be a positive safe integer");
  }

  return pageSize;
}

async function main(): Promise<void> {
  const [, , commandValue, ...args] = process.argv;
  const command = parseCommand(commandValue);

  if (command !== "refresh") {
    throw new Error(usage());
  }

  const databaseLocation =
    parseFlagValue(args, ["--database", "--db"]) ??
    process.env.INDEXER_DB_URL ??
    defaultDatabaseLocation;
  const rpcUrl =
    parseFlagValue(args, ["--rpc-url"]) ??
    process.env.RPC_URL_COSTON2 ??
    coston2Chain.rpcUrls.default.http[0];
  const assetManagerAddress = normalizeEvmAddress(
    parseFlagValue(args, ["--asset-manager"]) ??
      process.env.HARBOR_ASSET_MANAGER_ADDRESS ??
      coston2FxrpAssetManagerAddress,
  );
  const pageSize = parsePageSize(
    parseFlagValue(args, ["--page-size"]) ??
      process.env.HARBOR_AGENT_INVENTORY_PAGE_SIZE,
  );
  const includeAllAgents = !hasFlag(args, "--available-only");
  const publicClient = createPublicClient({
    chain: coston2Chain as Chain,
    transport: http(rpcUrl),
  });
  const database = openSqliteDatabase(databaseLocation);

  try {
    runMigrations(database);
    const summary = await refreshAgentInventory({
      database,
      publicClient: publicClient as unknown as ViemReadContractClient,
      assetManagerAddress,
      pageSize,
      includeAllAgents,
    });

    console.log(JSON.stringify(serializeBigints(summary), null, 2));
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
