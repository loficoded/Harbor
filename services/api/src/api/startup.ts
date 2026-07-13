import type { Server } from "node:http";

import type { EnvInput, IsoTimestamp } from "@harbor/shared";

import {
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from "../db/index.js";
import {
  resolveApiPort,
  resolveApiServerConfig,
  type ApiServerConfig,
} from "./config.js";
import { createApiServer } from "./server.js";
import type { ApiLogger } from "./logging.js";

export const defaultDatabaseLocation = "./data/harbor.sqlite";

export type ServiceComponentName =
  "indexer" | "xrplObserver" | "agentRefresh" | "keeper";

/**
 * Feature flags that select which parts of the service run in a given process.
 * Defaults keep local development API-only; the indexer, XRPL payment observer,
 * agent refresh, and keeper are opt-in so they can be run as separate
 * processes.
 */
export type StartupFlags = Readonly<{
  runMigrations: boolean;
  runApi: boolean;
  runIndexer: boolean;
  runXrplObserver: boolean;
  runAgentRefresh: boolean;
  runKeeper: boolean;
}>;

export type StartupConfig = Readonly<{
  databaseLocation: string;
  port: number;
  flags: StartupFlags;
  api: ApiServerConfig;
}>;

export type StartupLogger = Readonly<{
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}>;

export type ComponentHandle = Readonly<{
  name: ServiceComponentName;
  stop(): Promise<void> | void;
}>;

export type ComponentContext = Readonly<{
  database: SqliteDatabase;
  config: StartupConfig;
  env: EnvInput;
  logger: StartupLogger;
}>;

export type ComponentStarter = (
  context: ComponentContext,
) => Promise<ComponentHandle> | ComponentHandle;

export type ServiceComponentStarters = Readonly<{
  indexer?: ComponentStarter;
  xrplObserver?: ComponentStarter;
  agentRefresh?: ComponentStarter;
  keeper?: ComponentStarter;
}>;

export type HarborServiceHandle = Readonly<{
  config: StartupConfig;
  server: Server | null;
  port: number | null;
  components: readonly ComponentHandle[];
  stop(): Promise<void>;
}>;

export type StartHarborServiceOptions = Readonly<{
  env?: EnvInput;
  config?: StartupConfig;
  database?: SqliteDatabase;
  logger?: StartupLogger;
  apiLogger?: ApiLogger;
  now?: () => IsoTimestamp;
  componentStarters?: ServiceComponentStarters;
}>;

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next === undefined || next === "" ? undefined : next;
}

const truthyFlagValues = new Set(["1", "true", "yes", "on"]);
const falsyFlagValues = new Set(["0", "false", "no", "off"]);

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  const raw = trimmed(value)?.toLowerCase();

  if (raw === undefined) {
    return defaultValue;
  }

  if (truthyFlagValues.has(raw)) {
    return true;
  }

  if (falsyFlagValues.has(raw)) {
    return false;
  }

  throw new Error(
    `Expected a boolean value (true/false), received "${value ?? ""}"`,
  );
}

export function resolveStartupFlags(env: EnvInput = process.env): StartupFlags {
  return {
    runMigrations: parseBoolean(env["HARBOR_RUN_MIGRATIONS"], true),
    runApi: parseBoolean(env["HARBOR_RUN_API"], true),
    runIndexer: parseBoolean(env["HARBOR_RUN_INDEXER"], false),
    runXrplObserver: parseBoolean(env["HARBOR_RUN_XRPL_OBSERVER"], false),
    runAgentRefresh: parseBoolean(env["HARBOR_RUN_AGENT_REFRESH"], false),
    runKeeper: parseBoolean(env["HARBOR_RUN_KEEPER"], false),
  };
}

export function resolveStartupConfig(
  env: EnvInput = process.env,
): StartupConfig {
  return {
    databaseLocation: trimmed(env["INDEXER_DB_URL"]) ?? defaultDatabaseLocation,
    port: resolveApiPort(env),
    flags: resolveStartupFlags(env),
    api: resolveApiServerConfig(env),
  };
}

export function enabledComponents(
  flags: StartupFlags,
): readonly ServiceComponentName[] {
  const names: ServiceComponentName[] = [];

  if (flags.runIndexer) {
    names.push("indexer");
  }

  if (flags.runXrplObserver) {
    names.push("xrplObserver");
  }

  if (flags.runAgentRefresh) {
    names.push("agentRefresh");
  }

  if (flags.runKeeper) {
    names.push("keeper");
  }

  return names;
}

function nowIsoLine(): string {
  return new Date().toISOString();
}

export const defaultStartupLogger: StartupLogger = {
  info(message, fields) {
    console.log(
      JSON.stringify({
        level: "info",
        type: "service",
        timestamp: nowIsoLine(),
        message,
        ...(fields ?? {}),
      }),
    );
  },
  error(message, fields) {
    console.error(
      JSON.stringify({
        level: "error",
        type: "service",
        timestamp: nowIsoLine(),
        message,
        ...(fields ?? {}),
      }),
    );
  },
};

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };

    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();

      if (address === null || typeof address === "string") {
        resolve(port);
        return;
      }

      resolve(address.port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

/**
 * Compose the Harbor backend for a single process: run migrations, start the
 * flag-enabled optional components, and start the API server. Everything is
 * injectable (env, database, logger, clock, component starters) so tests can
 * drive the full lifecycle deterministically without touching the network.
 *
 * If any step fails, already-started pieces are torn down before rethrowing.
 * The returned handle's `stop()` shuts everything down in reverse order.
 */
export async function startHarborService(
  options: StartHarborServiceOptions = {},
): Promise<HarborServiceHandle> {
  const env = options.env ?? process.env;
  const config = options.config ?? resolveStartupConfig(env);
  const logger = options.logger ?? defaultStartupLogger;
  const starters = options.componentStarters ?? {};

  const ownsDatabase = options.database === undefined;
  const database =
    options.database ?? openSqliteDatabase(config.databaseLocation);

  const started: ComponentHandle[] = [];
  let server: Server | null = null;

  const stop = async (): Promise<void> => {
    for (const handle of [...started].reverse()) {
      try {
        await handle.stop();
      } catch (error) {
        logger.error(`failed to stop component ${handle.name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (server !== null) {
      await closeServer(server);
      server = null;
    }

    if (ownsDatabase) {
      database.close();
    }
  };

  try {
    if (config.flags.runMigrations) {
      const results = runMigrations(database);
      logger.info("migrations complete", {
        applied: results.filter((result) => result.applied).length,
        total: results.length,
      });
    }

    const context: ComponentContext = { database, config, env, logger };

    for (const name of enabledComponents(config.flags)) {
      const starter = starters[name];

      if (starter === undefined) {
        throw new Error(
          `Component "${name}" is enabled but no starter was provided`,
        );
      }

      const handle = await starter(context);
      started.push(handle);
      logger.info("component started", { component: name });
    }

    let port: number | null = null;

    if (config.flags.runApi) {
      server = createApiServer({
        database,
        config: config.api,
        ...(options.apiLogger === undefined
          ? {}
          : { logger: options.apiLogger }),
        ...(options.now === undefined ? {} : { now: options.now }),
      });
      port = await listen(server, config.port);
      logger.info("api listening", { port });
    }

    return {
      config,
      server,
      port,
      components: [...started],
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
