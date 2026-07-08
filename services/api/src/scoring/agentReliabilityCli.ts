import { coston2Chain, coston2FtsoV2Address } from "@harbor/protocol";
import { normalizeEvmAddress, serializeBigints } from "@harbor/shared";
import { createPublicClient, http, type Chain } from "viem";

import { openSqliteDatabase, runMigrations } from "../db/index.js";
import {
  defaultFtsoMaxAgeSeconds,
  refreshAgentReliabilityScores,
  type FtsoReadContractClient,
} from "./agentReliability.js";

type AgentReliabilityCommand = "refresh";

const defaultDatabaseLocation = "./data/harbor.sqlite";

function usage(): string {
  return [
    "Usage: node dist/scoring/agentReliabilityCli.js refresh [options]",
    "",
    "Options:",
    "  --database <path-or-file-url>        Defaults to INDEXER_DB_URL or ./data/harbor.sqlite",
    "  --rpc-url <url>                      Defaults to RPC_URL_COSTON2 or the pinned Coston2 RPC",
    "  --ftso-address <address>             Defaults to HARBOR_FTSO_V2_ADDRESS or the pinned Coston2 FtsoV2",
    "  --max-ftso-age-seconds <seconds>     Defaults to HARBOR_FTSO_MAX_AGE_SECONDS or 3600",
    "  --skip-ftso                          Score from history and inventory only",
  ].join("\n");
}

function parseCommand(value: string | undefined): AgentReliabilityCommand {
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

function parseMaxFtsoAgeSeconds(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return defaultFtsoMaxAgeSeconds;
  }

  const maxAgeSeconds = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
    throw new Error(
      "--max-ftso-age-seconds must be a non-negative safe integer",
    );
  }

  return maxAgeSeconds;
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
  const skipFtso = hasFlag(args, "--skip-ftso");
  const rpcUrl =
    parseFlagValue(args, ["--rpc-url"]) ??
    process.env.RPC_URL_COSTON2 ??
    coston2Chain.rpcUrls.default.http[0];
  const ftsoV2Address = normalizeEvmAddress(
    parseFlagValue(args, ["--ftso-address"]) ??
      process.env.HARBOR_FTSO_V2_ADDRESS ??
      coston2FtsoV2Address,
  );
  const maxFtsoAgeSeconds = parseMaxFtsoAgeSeconds(
    parseFlagValue(args, ["--max-ftso-age-seconds"]) ??
      process.env.HARBOR_FTSO_MAX_AGE_SECONDS,
  );
  const publicClient = createPublicClient({
    chain: coston2Chain as Chain,
    transport: http(rpcUrl),
  });
  const database = openSqliteDatabase(databaseLocation);

  try {
    runMigrations(database);
    const summary = await refreshAgentReliabilityScores({
      database,
      ftsoClient: skipFtso
        ? undefined
        : (publicClient as unknown as FtsoReadContractClient),
      ftsoV2Address: skipFtso ? undefined : ftsoV2Address,
      maxFtsoAgeSeconds,
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
