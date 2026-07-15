import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test, type TestContext } from "node:test";

import { coston2Chain, coston2FxrpAssetManagerAddress } from "@harbor/protocol";
import type { EvmAddress } from "@harbor/shared";
import { createPublicClient, http, type Chain } from "viem";

import {
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from "../db/index.js";
import { getAgent, upsertAgent } from "../repositories/agents.js";
import {
  assetManagerAbiHasFunction,
  defaultAgentInventoryPageSize,
  readAgentDetails,
  readAgentOwnerRegistryAddress,
  readAllAgentVaults,
  readAvailableAgentDetailedList,
  readAvailableAgentVaults,
  refreshAgentInventory,
  type ViemReadContractClient,
} from "./agentInventory.js";

type ReadContractParameters = Parameters<
  ViemReadContractClient["readContract"]
>[0];

const assetManagerAddress = `0x${"11".repeat(20)}` as EvmAddress;
const agentVaultA = `0x${"aa".repeat(20)}` as EvmAddress;
const agentVaultB = `0x${"bb".repeat(20)}` as EvmAddress;
const agentVaultC = `0x${"cc".repeat(20)}` as EvmAddress;
const agentVaultD = `0x${"dd".repeat(20)}` as EvmAddress;
const ownerAddress = `0x${"12".repeat(20)}` as EvmAddress;
const ownerWorkAddress = `0x${"13".repeat(20)}` as EvmAddress;
const collateralPool = `0x${"14".repeat(20)}` as EvmAddress;
const collateralPoolToken = `0x${"15".repeat(20)}` as EvmAddress;
const vaultCollateralToken = `0x${"16".repeat(20)}` as EvmAddress;
const poolWNatToken = `0x${"17".repeat(20)}` as EvmAddress;

function createTestDatabase(t: TestContext): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), "harbor-agent-inventory-db-"));
  const databasePath = join(directory, "harbor.sqlite");
  const database = openSqliteDatabase(databasePath);
  runMigrations(database);

  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  return database;
}

function countRows(database: SqliteDatabase, tableName: string): number {
  const row = database
    .prepare<[], { count: number }>(
      `SELECT COUNT(*) AS count FROM ${tableName}`,
    )
    .get();

  return row?.count ?? 0;
}

function createMockReadClient(
  handler: (parameters: ReadContractParameters) => unknown | Promise<unknown>,
): { client: ViemReadContractClient; calls: ReadContractParameters[] } {
  const calls: ReadContractParameters[] = [];

  return {
    calls,
    client: {
      async readContract(parameters) {
        calls.push(parameters);
        return handler(parameters);
      },
    },
  };
}

function availableAgentDetail(overrides: Record<string, unknown> = {}) {
  return {
    agentVault: agentVaultA,
    ownerManagementAddress: ownerAddress,
    feeBIPS: 25n,
    mintingVaultCollateralRatioBIPS: 14_000n,
    mintingPoolCollateralRatioBIPS: 15_000n,
    freeCollateralLots: 7n,
    status: 0n,
    ...overrides,
  };
}

function agentInfo(overrides: Record<string, unknown> = {}) {
  return {
    status: 0n,
    ownerManagementAddress: ownerAddress,
    ownerWorkAddress,
    collateralPool,
    collateralPoolToken,
    underlyingAddressString: "rAgentUnderlyingAddress",
    publiclyAvailable: true,
    feeBIPS: 25n,
    poolFeeShareBIPS: 1_500n,
    vaultCollateralToken,
    mintingVaultCollateralRatioBIPS: 14_000n,
    mintingPoolCollateralRatioBIPS: 15_000n,
    freeCollateralLots: 7n,
    totalVaultCollateralWei: 123456789012345678901234567890n,
    freeVaultCollateralWei: 12345678901234567890n,
    vaultCollateralRatioBIPS: 20_000n,
    poolWNatToken,
    totalPoolCollateralNATWei: 22222222222222222222n,
    freePoolCollateralNATWei: 33333333333333333333n,
    poolCollateralRatioBIPS: 21_000n,
    totalAgentPoolTokensWei: 44444444444444444444n,
    freeAgentPoolTokensWei: 55555555555555555555n,
    mintedUBA: 10n,
    reservedUBA: 20n,
    redeemingUBA: 30n,
    poolRedeemingUBA: 40n,
    dustUBA: 5n,
    underlyingBalanceUBA: 1_000n,
    requiredUnderlyingBalanceUBA: 900n,
    freeUnderlyingBalanceUBA: 100n,
    liquidationStartTimestamp: 0n,
    maxLiquidationAmountUBA: 0n,
    liquidationPaymentFactorVaultBIPS: 0n,
    liquidationPaymentFactorPoolBIPS: 0n,
    poolExitCollateralRatioBIPS: 18_000n,
    redemptionPoolFeeShareBIPS: 2_000n,
    ...overrides,
  };
}

describe("Agent inventory AssetManager reader", () => {
  test("detects detailed available-agent support in the pinned ABI", () => {
    assert.equal(
      assetManagerAbiHasFunction("getAvailableAgentsDetailedList"),
      true,
    );
  });

  test("reads available agent vaults with start/end pagination boundaries", async () => {
    const { client, calls } = createMockReadClient(({ functionName, args }) => {
      assert.equal(functionName, "getAvailableAgentsList");

      if (args?.[0] === 0n && args[1] === 2n) {
        return [[agentVaultA, agentVaultB], 4n];
      }

      if (args?.[0] === 2n && args[1] === 4n) {
        return [[agentVaultC, agentVaultD], 4n];
      }

      throw new Error(`unexpected page ${String(args?.[0])}`);
    });

    const agents = await readAvailableAgentVaults({
      publicClient: client,
      assetManagerAddress,
      pageSize: 2,
    });

    assert.deepEqual(agents, [
      agentVaultA,
      agentVaultB,
      agentVaultC,
      agentVaultD,
    ]);
    assert.deepEqual(
      calls.map((call) => call.args),
      [
        [0n, 2n],
        [2n, 4n],
      ],
    );
  });

  test("reads detailed available-agent pages and tuple-shaped rows", async () => {
    const { client } = createMockReadClient(({ functionName, args }) => {
      assert.equal(functionName, "getAvailableAgentsDetailedList");

      if (args?.[0] === 0n && args[1] === 2n) {
        return [
          [
            availableAgentDetail({ agentVault: agentVaultA }),
            [agentVaultB, ownerAddress, 31n, 16_000n, 17_000n, 11n, 1n],
          ],
          3n,
        ];
      }

      if (args?.[0] === 2n && args[1] === 4n) {
        return [
          [availableAgentDetail({ agentVault: agentVaultC, feeBIPS: 45n })],
          3n,
        ];
      }

      throw new Error(`unexpected page ${String(args?.[0])}`);
    });

    const details = await readAvailableAgentDetailedList({
      publicClient: client,
      assetManagerAddress,
      pageSize: 2,
    });

    assert.equal(details.length, 3);
    assert.equal(details[1]?.agentVault, agentVaultB);
    assert.equal(details[1]?.feeBIPS, 31n);
    assert.equal(details[2]?.feeBIPS, 45n);
  });

  test("handles empty all-agent pages", async () => {
    const { client, calls } = createMockReadClient(({ functionName }) => {
      assert.equal(functionName, "getAllAgents");
      return [[], 0n];
    });

    const agents = await readAllAgentVaults({
      publicClient: client,
      assetManagerAddress,
      pageSize: 5,
    });

    assert.deepEqual(agents, []);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, [0n, 5n]);
  });

  test("wraps RPC page failures with AssetManager context", async () => {
    const { client } = createMockReadClient(() => {
      throw new Error("rpc timeout");
    });

    await assert.rejects(
      readAvailableAgentVaults({
        publicClient: client,
        assetManagerAddress,
      }),
      /AssetManager getAvailableAgentsList read failed.*rpc timeout/,
    );
  });

  test("refreshes inventory idempotently and preserves existing scores", async (t) => {
    const database = createTestDatabase(t);
    upsertAgent(database, {
      agentVault: agentVaultA,
      availability: "UNKNOWN",
      availableLots: 1n,
      score: {
        agentVault: agentVaultA,
        score: 88.5,
        successfulRedemptions: 12,
        failedRedemptions: 1,
        averagePaymentSeconds: 45,
        updatedAt: "2026-07-08T02:00:00.000Z",
      },
      createdAt: "2026-07-08T02:00:00.000Z",
      updatedAt: "2026-07-08T02:00:00.000Z",
    });
    const { client } = createMockReadClient(({ functionName }) => {
      if (functionName === "getAvailableAgentsDetailedList") {
        return [[availableAgentDetail({ agentVault: agentVaultA })], 1n];
      }

      if (functionName === "getAllAgents") {
        return [[agentVaultA], 1n];
      }

      if (functionName === "getAgentInfo") {
        return agentInfo({
          feeBIPS: 30n,
          freeCollateralLots: 9n,
          totalVaultCollateralWei: 123456789012345678901234567890n,
        });
      }

      throw new Error(`unexpected function ${functionName}`);
    });

    const firstSummary = await refreshAgentInventory({
      database,
      publicClient: client,
      assetManagerAddress,
      pageSize: 2,
      refreshedAt: "2026-07-08T03:00:00.000Z",
    });
    const secondSummary = await refreshAgentInventory({
      database,
      publicClient: client,
      assetManagerAddress,
      pageSize: 2,
      refreshedAt: "2026-07-08T03:01:00.000Z",
    });
    const storedAgent = getAgent(database, agentVaultA);

    assert.equal(firstSummary.agentsPersisted, 1);
    assert.equal(secondSummary.agentsPersisted, 1);
    assert.equal(countRows(database, "agents"), 1);
    assert.equal(storedAgent?.availability, "AVAILABLE");
    assert.equal(storedAgent?.availableLots, 9n);
    assert.equal(storedAgent?.redemptionFeeBips, 30);
    assert.equal(storedAgent?.score.score, 88.5);
    assert.equal(storedAgent?.score.successfulRedemptions, 12);
    assert.equal(
      storedAgent?.lastInventoryRefreshAt,
      "2026-07-08T03:01:00.000Z",
    );

    const rawInventory = JSON.parse(storedAgent?.rawInventoryJson ?? "{}") as {
      agentInfo?: Record<string, unknown>;
    };
    const feeFields = JSON.parse(storedAgent?.feeFieldsJson ?? "{}") as Record<
      string,
      unknown
    >;
    const collateralMetadata = JSON.parse(
      storedAgent?.collateralMetadataJson ?? "{}",
    ) as Record<string, unknown>;

    assert.equal(
      rawInventory.agentInfo?.totalVaultCollateralWei,
      "123456789012345678901234567890",
    );
    assert.equal(feeFields.feeBIPS, "30");
    assert.equal(feeFields.poolFeeShareBIPS, "1500");
    assert.equal(
      collateralMetadata.totalVaultCollateralWei,
      "123456789012345678901234567890",
    );
  });

  test("does not persist partial inventory when detail refresh fails", async (t) => {
    const database = createTestDatabase(t);
    const { client } = createMockReadClient(({ functionName }) => {
      if (functionName === "getAvailableAgentsDetailedList") {
        return [[availableAgentDetail({ agentVault: agentVaultA })], 1n];
      }

      if (functionName === "getAllAgents") {
        return [[agentVaultA], 1n];
      }

      throw new Error("agent detail unavailable");
    });

    await assert.rejects(
      refreshAgentInventory({
        database,
        publicClient: client,
        assetManagerAddress,
        pageSize: 2,
        refreshedAt: "2026-07-08T04:00:00.000Z",
      }),
      /getAgentInfo.*agent detail unavailable/,
    );
    assert.equal(countRows(database, "agents"), 0);
  });

  test(
    "optional live Coston2 agent inventory smoke test",
    {
      skip:
        process.env.HARBOR_COSTON2_AGENT_INVENTORY_SMOKE === "1"
          ? false
          : "set HARBOR_COSTON2_AGENT_INVENTORY_SMOKE=1 to run",
    },
    async (t) => {
      const database = createTestDatabase(t);
      const publicClient = createPublicClient({
        chain: coston2Chain as Chain,
        transport: http(
          process.env.RPC_URL_COSTON2 ?? coston2Chain.rpcUrls.default.http[0],
        ),
      });
      const pageSize =
        process.env.HARBOR_COSTON2_AGENT_INVENTORY_PAGE_SIZE === undefined
          ? 5
          : Number.parseInt(
              process.env.HARBOR_COSTON2_AGENT_INVENTORY_PAGE_SIZE,
              10,
            );

      const summary = await refreshAgentInventory({
        database,
        publicClient: publicClient as unknown as ViemReadContractClient,
        assetManagerAddress: coston2FxrpAssetManagerAddress,
        pageSize,
      });

      assert.ok(summary.pageSize > 0);
      assert.ok(summary.agentsRefreshed >= 0);
    },
  );

  test("documents the default page size used by the refresh command", () => {
    assert.equal(defaultAgentInventoryPageSize, 25);
  });
});

const agentOwnerRegistryAddress = `0x${"a0".repeat(20)}` as EvmAddress;

describe("AgentOwnerRegistry official agent details", () => {
  describe("readAgentOwnerRegistryAddress", () => {
    test("resolves the registry from the settings struct (named field)", async () => {
      const { client } = createMockReadClient(({ functionName }) => {
        assert.equal(functionName, "getSettings");
        return { agentOwnerRegistry: agentOwnerRegistryAddress };
      });

      const resolved = await readAgentOwnerRegistryAddress({
        publicClient: client,
        assetManagerAddress,
      });

      assert.equal(resolved, agentOwnerRegistryAddress);
    });

    test("resolves the registry from a positional settings tuple", async () => {
      const { client } = createMockReadClient(() => {
        // agentOwnerRegistry is index 7 in the settings tuple.
        const tuple = new Array(8).fill(`0x${"00".repeat(20)}`);
        tuple[7] = agentOwnerRegistryAddress;
        return tuple;
      });

      const resolved = await readAgentOwnerRegistryAddress({
        publicClient: client,
        assetManagerAddress,
      });

      assert.equal(resolved, agentOwnerRegistryAddress);
    });

    test("returns null for a zero/unset registry address", async () => {
      const { client } = createMockReadClient(() => ({
        agentOwnerRegistry: `0x${"00".repeat(20)}`,
      }));

      assert.equal(
        await readAgentOwnerRegistryAddress({
          publicClient: client,
          assetManagerAddress,
        }),
        null,
      );
    });

    test("is non-fatal: returns null when getSettings reverts", async () => {
      const { client } = createMockReadClient(() => {
        throw new Error("settings unavailable");
      });

      assert.equal(
        await readAgentOwnerRegistryAddress({
          publicClient: client,
          assetManagerAddress,
        }),
        null,
      );
    });
  });

  describe("readAgentDetails", () => {
    test("reads all four getters, trimming and null-collapsing empties", async () => {
      const { client, calls } = createMockReadClient(({ functionName }) => {
        switch (functionName) {
          case "getAgentName":
            return "  Acme Redeemer  ";
          case "getAgentDescription":
            return "";
          case "getAgentIconUrl":
            return "https://cdn.example.com/acme.png";
          case "getAgentTermsOfUseUrl":
            return "   ";
          default:
            throw new Error(`unexpected function ${functionName}`);
        }
      });

      const details = await readAgentDetails({
        publicClient: client,
        agentOwnerRegistryAddress,
        managementAddress: ownerAddress,
      });

      assert.deepEqual(details, {
        name: "Acme Redeemer",
        description: null,
        iconUrl: "https://cdn.example.com/acme.png",
        termsOfUseUrl: null,
      });
      // Every getter is passed the management address.
      for (const call of calls) {
        assert.deepEqual(call.args, [ownerAddress]);
      }
    });

    test("is resilient per field: a reverting getter yields null for that field only", async () => {
      const { client } = createMockReadClient(({ functionName }) => {
        if (functionName === "getAgentIconUrl") {
          throw new Error("icon getter reverted");
        }
        if (functionName === "getAgentName") {
          return "Acme";
        }
        return "";
      });

      const details = await readAgentDetails({
        publicClient: client,
        agentOwnerRegistryAddress,
        managementAddress: ownerAddress,
      });

      assert.equal(details.name, "Acme");
      assert.equal(details.iconUrl, null);
    });

    test("never throws when the whole registry is unreadable", async () => {
      const { client } = createMockReadClient(() => {
        throw new Error("registry down");
      });

      const details = await readAgentDetails({
        publicClient: client,
        agentOwnerRegistryAddress,
        managementAddress: ownerAddress,
      });

      assert.deepEqual(details, {
        name: null,
        description: null,
        iconUrl: null,
        termsOfUseUrl: null,
      });
    });
  });

  function detailAwareHandler(
    overrides: {
      settings?: () => unknown;
      details?: Partial<Record<string, string>>;
    } = {},
  ) {
    return ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "getAvailableAgentsDetailedList":
          return [[availableAgentDetail({ agentVault: agentVaultA })], 1n];
        case "getAllAgents":
          return [[agentVaultA], 1n];
        case "getAgentInfo":
          return agentInfo();
        case "getSettings":
          return overrides.settings
            ? overrides.settings()
            : { agentOwnerRegistry: agentOwnerRegistryAddress };
        case "getAgentName":
        case "getAgentDescription":
        case "getAgentIconUrl":
        case "getAgentTermsOfUseUrl":
          return overrides.details?.[functionName] ?? "";
        default:
          throw new Error(`unexpected function ${functionName}`);
      }
    };
  }

  test("refresh persists official details resolved from the registry", async (t) => {
    const database = createTestDatabase(t);
    const { client } = createMockReadClient(
      detailAwareHandler({
        details: {
          getAgentName: "Acme Redeemer",
          getAgentDescription: "Reliable FXRP agent",
          getAgentIconUrl: "https://cdn.example.com/acme.png",
        },
      }),
    );

    const summary = await refreshAgentInventory({
      database,
      publicClient: client,
      assetManagerAddress,
      pageSize: 5,
      refreshedAt: "2026-07-08T05:00:00.000Z",
    });

    assert.equal(summary.agentOwnerRegistryAddress, agentOwnerRegistryAddress);
    assert.equal(summary.agentDetailsRead, 1);

    const stored = getAgent(database, agentVaultA);
    assert.deepEqual(stored?.details, {
      name: "Acme Redeemer",
      description: "Reliable FXRP agent",
      iconUrl: "https://cdn.example.com/acme.png",
      termsOfUseUrl: null,
    });
  });

  test("refresh is non-fatal when the registry cannot be resolved", async (t) => {
    const database = createTestDatabase(t);
    const { client } = createMockReadClient(
      detailAwareHandler({
        settings: () => {
          throw new Error("settings unavailable");
        },
      }),
    );

    const summary = await refreshAgentInventory({
      database,
      publicClient: client,
      assetManagerAddress,
      pageSize: 5,
      refreshedAt: "2026-07-08T05:10:00.000Z",
    });

    assert.equal(summary.agentOwnerRegistryAddress, null);
    assert.equal(summary.agentDetailsRead, 0);
    assert.equal(summary.agentsPersisted, 1);

    const stored = getAgent(database, agentVaultA);
    assert.deepEqual(stored?.details, {
      name: null,
      description: null,
      iconUrl: null,
      termsOfUseUrl: null,
    });
  });

  test("refresh skips detail reads when includeAgentDetails is false", async (t) => {
    const database = createTestDatabase(t);
    const { client, calls } = createMockReadClient(detailAwareHandler());

    const summary = await refreshAgentInventory({
      database,
      publicClient: client,
      assetManagerAddress,
      pageSize: 5,
      includeAgentDetails: false,
      refreshedAt: "2026-07-08T05:20:00.000Z",
    });

    assert.equal(summary.agentOwnerRegistryAddress, null);
    assert.equal(summary.agentDetailsRead, 0);
    assert.equal(
      calls.some((call) => call.functionName === "getSettings"),
      false,
    );
    assert.equal(
      calls.some((call) => call.functionName === "getAgentName"),
      false,
    );
  });

  test("refresh reflects cleared registry fields (fetched empties overwrite)", async (t) => {
    const database = createTestDatabase(t);
    upsertAgent(database, {
      agentVault: agentVaultA,
      details: {
        name: "Stale Name",
        description: "Stale description",
        iconUrl: "https://old.example.com/logo.png",
        termsOfUseUrl: null,
      },
    });

    const { client } = createMockReadClient(detailAwareHandler({ details: {} }));
    await refreshAgentInventory({
      database,
      publicClient: client,
      assetManagerAddress,
      pageSize: 5,
      refreshedAt: "2026-07-08T05:30:00.000Z",
    });

    const stored = getAgent(database, agentVaultA);
    assert.deepEqual(stored?.details, {
      name: null,
      description: null,
      iconUrl: null,
      termsOfUseUrl: null,
    });
  });

  test("refresh preserves stored details when details are not fetched", async (t) => {
    const database = createTestDatabase(t);
    upsertAgent(database, {
      agentVault: agentVaultA,
      details: {
        name: "Kept Name",
        description: null,
        iconUrl: "https://kept.example.com/logo.png",
        termsOfUseUrl: null,
      },
    });

    const { client } = createMockReadClient(
      detailAwareHandler({
        settings: () => {
          throw new Error("settings unavailable");
        },
      }),
    );
    await refreshAgentInventory({
      database,
      publicClient: client,
      assetManagerAddress,
      pageSize: 5,
      refreshedAt: "2026-07-08T05:40:00.000Z",
    });

    const stored = getAgent(database, agentVaultA);
    assert.equal(stored?.details.name, "Kept Name");
    assert.equal(stored?.details.iconUrl, "https://kept.example.com/logo.png");
  });
});
