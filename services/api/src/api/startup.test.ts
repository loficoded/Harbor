import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";

import {
  listAppliedMigrations,
  openSqliteDatabase,
  type SqliteDatabase,
} from "../db/index.js";
import { resolveApiServerConfig } from "./config.js";
import { noopApiLogger } from "./logging.js";
import {
  resolveStartupConfig,
  resolveStartupFlags,
  startHarborService,
  type ComponentHandle,
  type ComponentStarter,
  type StartupConfig,
  type StartupFlags,
  type StartupLogger,
} from "./startup.js";

const silentLogger: StartupLogger = {
  info() {
    // Silent in tests.
  },
  error() {
    // Silent in tests.
  },
};

function memoryDatabase(t: TestContext): SqliteDatabase {
  const database = openSqliteDatabase(":memory:");

  t.after(() => {
    try {
      database.close();
    } catch {
      // Already closed.
    }
  });

  return database;
}

function startupConfig(flags: Partial<StartupFlags> = {}): StartupConfig {
  return {
    databaseLocation: ":memory:",
    port: 0,
    flags: {
      runMigrations: true,
      runApi: true,
      runIndexer: false,
      runXrplObserver: false,
      runAgentRefresh: false,
      runKeeper: false,
      ...flags,
    },
    api: resolveApiServerConfig({}),
  };
}

function recordingStarter(
  name: ComponentHandle["name"],
  started: string[],
  stopped: string[],
): ComponentStarter {
  return () => {
    started.push(name);
    return {
      name,
      stop: () => {
        stopped.push(name);
      },
    };
  };
}

describe("resolveStartupFlags", () => {
  test("defaults to API-only with migrations", () => {
    assert.deepEqual(resolveStartupFlags({}), {
      runMigrations: true,
      runApi: true,
      runIndexer: false,
      runXrplObserver: false,
      runAgentRefresh: false,
      runKeeper: false,
    });
  });

  test("honors explicit boolean overrides", () => {
    assert.deepEqual(
      resolveStartupFlags({
        HARBOR_RUN_API: "false",
        HARBOR_RUN_INDEXER: "true",
        HARBOR_RUN_XRPL_OBSERVER: "true",
        HARBOR_RUN_KEEPER: "1",
      }),
      {
        runMigrations: true,
        runApi: false,
        runIndexer: true,
        runXrplObserver: true,
        runAgentRefresh: false,
        runKeeper: true,
      },
    );
  });

  test("rejects a non-boolean flag value", () => {
    assert.throws(
      () => resolveStartupFlags({ HARBOR_RUN_API: "maybe" }),
      /Expected a boolean value/,
    );
  });
});

describe("resolveStartupConfig", () => {
  test("resolves database location and port from env", () => {
    const config = resolveStartupConfig({
      INDEXER_DB_URL: "./tmp/harbor.sqlite",
      HARBOR_API_PORT: "4100",
    });

    assert.equal(config.databaseLocation, "./tmp/harbor.sqlite");
    assert.equal(config.port, 4100);
    assert.equal(config.flags.runApi, true);
  });
});

describe("startHarborService", () => {
  test("runs migrations and starts the API server by default", async (t) => {
    const database = memoryDatabase(t);

    const handle = await startHarborService({
      config: startupConfig(),
      database,
      logger: silentLogger,
      apiLogger: noopApiLogger,
    });

    t.after(() => handle.stop());

    assert.equal(listAppliedMigrations(database).length, 5);
    assert.deepEqual(handle.components, []);
    assert.ok(handle.server !== null);
    assert.equal(typeof handle.port, "number");

    const response = await fetch(`http://127.0.0.1:${handle.port}/health`);
    const body = (await response.json()) as { status: string };
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
  });

  test("starts enabled components in order and stops them in reverse", async (t) => {
    const database = memoryDatabase(t);
    const started: string[] = [];
    const stopped: string[] = [];

    const handle = await startHarborService({
      config: startupConfig({
        runApi: false,
        runIndexer: true,
        runAgentRefresh: true,
        runKeeper: true,
      }),
      database,
      logger: silentLogger,
      componentStarters: {
        indexer: recordingStarter("indexer", started, stopped),
        agentRefresh: recordingStarter("agentRefresh", started, stopped),
        keeper: recordingStarter("keeper", started, stopped),
      },
    });

    assert.deepEqual(started, ["indexer", "agentRefresh", "keeper"]);
    assert.equal(handle.server, null);
    assert.equal(handle.port, null);
    assert.equal(handle.components.length, 3);

    await handle.stop();
    assert.deepEqual(stopped, ["keeper", "agentRefresh", "indexer"]);
  });

  test("throws when an enabled component has no starter", async (t) => {
    const database = memoryDatabase(t);

    await assert.rejects(
      startHarborService({
        config: startupConfig({ runApi: false, runKeeper: true }),
        database,
        logger: silentLogger,
      }),
      /Component "keeper" is enabled but no starter was provided/,
    );
  });

  test("leaves an injected database open after stop", async (t) => {
    const database = memoryDatabase(t);

    const handle = await startHarborService({
      config: startupConfig(),
      database,
      logger: silentLogger,
      apiLogger: noopApiLogger,
    });

    assert.ok(handle.server !== null);
    const server = handle.server;

    await handle.stop();

    assert.equal(server.listening, false);
    // The injected database must remain usable (the caller owns it).
    assert.equal(listAppliedMigrations(database).length, 5);
  });
});
