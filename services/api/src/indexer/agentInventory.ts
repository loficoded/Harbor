import {
  agentOwnerRegistryAbi,
  iAssetManagerAbi,
  type Abi as ProtocolAbi,
} from "@harbor/protocol";
import {
  normalizeAgentDetailField,
  normalizeEvmAddress,
  serializeBigints,
  type AgentDetails,
  type EvmAddress,
  type IsoTimestamp,
  type XrplAddress,
} from "@harbor/shared";
import type { Abi as ViemAbi, Address } from "viem";

import type { SqliteDatabase } from "../db/index.js";
import { upsertAgent } from "../repositories/agents.js";
import type { UpsertAgentInput } from "../repositories/types.js";

export const defaultAgentInventoryPageSize = 25;

const assetManagerReadAbi = iAssetManagerAbi as unknown as ViemAbi;
const agentOwnerRegistryReadAbi = agentOwnerRegistryAbi as unknown as ViemAbi;

const zeroAddress = "0x0000000000000000000000000000000000000000";

/**
 * Ordered `AgentOwnerRegistry` getters (Flare FAssets spec) mapped to the
 * `AgentDetails` field each populates. Read together for a management address.
 */
const agentDetailFunctions = [
  ["name", "getAgentName"],
  ["description", "getAgentDescription"],
  ["iconUrl", "getAgentIconUrl"],
  ["termsOfUseUrl", "getAgentTermsOfUseUrl"],
] as const satisfies readonly (readonly [keyof AgentDetails, string])[];

const availableAgentDetailFields = [
  ["agentVault", 0],
  ["ownerManagementAddress", 1],
  ["feeBIPS", 2],
  ["mintingVaultCollateralRatioBIPS", 3],
  ["mintingPoolCollateralRatioBIPS", 4],
  ["freeCollateralLots", 5],
  ["status", 6],
] as const;

const agentInfoFields = [
  ["status", 0],
  ["ownerManagementAddress", 1],
  ["ownerWorkAddress", 2],
  ["collateralPool", 3],
  ["collateralPoolToken", 4],
  ["underlyingAddressString", 5],
  ["publiclyAvailable", 6],
  ["feeBIPS", 7],
  ["poolFeeShareBIPS", 8],
  ["vaultCollateralToken", 9],
  ["mintingVaultCollateralRatioBIPS", 10],
  ["mintingPoolCollateralRatioBIPS", 11],
  ["freeCollateralLots", 12],
  ["totalVaultCollateralWei", 13],
  ["freeVaultCollateralWei", 14],
  ["vaultCollateralRatioBIPS", 15],
  ["poolWNatToken", 16],
  ["totalPoolCollateralNATWei", 17],
  ["freePoolCollateralNATWei", 18],
  ["poolCollateralRatioBIPS", 19],
  ["totalAgentPoolTokensWei", 20],
  ["announcedVaultCollateralWithdrawalWei", 21],
  ["announcedPoolTokensWithdrawalWei", 22],
  ["freeAgentPoolTokensWei", 23],
  ["mintedUBA", 24],
  ["reservedUBA", 25],
  ["redeemingUBA", 26],
  ["poolRedeemingUBA", 27],
  ["dustUBA", 28],
  ["liquidationStartTimestamp", 29],
  ["maxLiquidationAmountUBA", 30],
  ["liquidationPaymentFactorVaultBIPS", 31],
  ["liquidationPaymentFactorPoolBIPS", 32],
  ["underlyingBalanceUBA", 33],
  ["requiredUnderlyingBalanceUBA", 34],
  ["freeUnderlyingBalanceUBA", 35],
  ["announcedUnderlyingWithdrawalId", 36],
  ["buyFAssetByAgentFactorBIPS", 37],
  ["poolExitCollateralRatioBIPS", 38],
  ["redemptionPoolFeeShareBIPS", 39],
] as const;

type IndexedTupleField = readonly [name: string, index: number];

type PaginatedReadInput = Readonly<{
  publicClient: ViemReadContractClient;
  assetManagerAddress: EvmAddress;
  pageSize?: number;
}>;

export type ViemReadContractClient = Readonly<{
  readContract(parameters: {
    address: Address;
    abi: ViemAbi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}>;

export type AvailableAgentDetail = Readonly<{
  agentVault: EvmAddress;
  ownerManagementAddress: EvmAddress | null;
  feeBIPS: bigint | null;
  mintingVaultCollateralRatioBIPS: bigint | null;
  mintingPoolCollateralRatioBIPS: bigint | null;
  freeCollateralLots: bigint;
  status: bigint | null;
  raw: Readonly<Record<string, unknown>>;
}>;

export type AgentInfoDetail = Readonly<{
  agentVault: EvmAddress;
  raw: Readonly<Record<string, unknown>>;
}>;

export type RefreshAgentInventoryInput = PaginatedReadInput &
  Readonly<{
    database: SqliteDatabase;
    includeAllAgents?: boolean;
    /**
     * Whether to read official agent details (name/description/icon/terms)
     * from the `AgentOwnerRegistry`. Defaults to `true`. Detail reads are
     * always non-fatal: a failure leaves the agent's stored details untouched
     * and never aborts the inventory refresh.
     */
    includeAgentDetails?: boolean;
    /**
     * Explicit `AgentOwnerRegistry` address. When omitted (and detail reads are
     * enabled) it is resolved from `AssetManager.getSettings()`. `null` skips
     * detail reads entirely.
     */
    agentOwnerRegistryAddress?: EvmAddress | null;
    refreshedAt?: IsoTimestamp;
  }>;

export type AgentInventoryRefreshSummary = Readonly<{
  assetManagerAddress: EvmAddress;
  refreshedAt: IsoTimestamp;
  pageSize: number;
  detailedAvailableListSupported: boolean;
  availableAgentsRead: number;
  availableAgentDetailsRead: number;
  allAgentsRead: number;
  agentsRefreshed: number;
  agentsPersisted: number;
  /**
   * Resolved `AgentOwnerRegistry` address used for detail reads, or `null`
   * when detail reads were disabled or the registry could not be resolved.
   */
  agentOwnerRegistryAddress: EvmAddress | null;
  /** Number of agents for which official details were read this refresh. */
  agentDetailsRead: number;
}>;

export function assetManagerAbiHasFunction(
  functionName: string,
  abi: ProtocolAbi = iAssetManagerAbi,
): boolean {
  return abi.some(
    (fragment) =>
      fragment.type === "function" && fragment.name === functionName,
  );
}

export async function readAvailableAgentVaults(
  input: PaginatedReadInput,
): Promise<readonly EvmAddress[]> {
  return readPaginatedAssetManagerList(
    input,
    "getAvailableAgentsList",
    parseAddressListPage,
  );
}

export async function readAllAgentVaults(
  input: PaginatedReadInput,
): Promise<readonly EvmAddress[]> {
  return readPaginatedAssetManagerList(
    input,
    "getAllAgents",
    parseAddressListPage,
  );
}

export async function readAvailableAgentDetailedList(
  input: PaginatedReadInput,
): Promise<readonly AvailableAgentDetail[]> {
  return readPaginatedAssetManagerList(
    input,
    "getAvailableAgentsDetailedList",
    parseAvailableAgentDetailListPage,
  );
}

export async function readAgentInfo(
  input: Omit<PaginatedReadInput, "pageSize"> &
    Readonly<{ agentVault: EvmAddress }>,
): Promise<AgentInfoDetail> {
  const agentVault = normalizeEvmAddress(input.agentVault);
  const result = await readAssetManagerContract(
    input.publicClient,
    input.assetManagerAddress,
    "getAgentInfo",
    [agentVault],
    `agent ${agentVault}`,
  );

  return {
    agentVault,
    raw: namedTupleToRecord(result, agentInfoFields),
  };
}

/**
 * Resolve the `AgentOwnerRegistry` address from the AssetManager settings
 * (`getSettings().agentOwnerRegistry`), per the Flare FAssets spec. Non-fatal:
 * returns `null` when settings cannot be read or the registry is unset/zero,
 * so a missing registry degrades to "no official details" rather than aborting
 * the inventory refresh.
 */
export async function readAgentOwnerRegistryAddress(input: {
  publicClient: ViemReadContractClient;
  assetManagerAddress: EvmAddress;
}): Promise<EvmAddress | null> {
  try {
    const settings = await input.publicClient.readContract({
      address: input.assetManagerAddress as Address,
      abi: assetManagerReadAbi,
      functionName: "getSettings",
    });
    const registry = optionalEvmAddress(
      readResultField(settings, ["agentOwnerRegistry"], 7),
      "agentOwnerRegistry",
    );

    return registry === null || registry.toLowerCase() === zeroAddress
      ? null
      : registry;
  } catch {
    return null;
  }
}

/**
 * Read an agent owner's official details from the `AgentOwnerRegistry` for a
 * management address. Each getter is read independently and resiliently: a
 * getter that reverts or returns a non-string yields `null` for that field
 * only, so incomplete metadata still surfaces the fields that are available.
 * This function never throws; an all-`null` result is the documented fallback.
 */
export async function readAgentDetails(input: {
  publicClient: ViemReadContractClient;
  agentOwnerRegistryAddress: EvmAddress;
  managementAddress: EvmAddress;
}): Promise<AgentDetails> {
  const entries = await Promise.all(
    agentDetailFunctions.map(async ([field, functionName]) => {
      try {
        const result = await input.publicClient.readContract({
          address: input.agentOwnerRegistryAddress as Address,
          abi: agentOwnerRegistryReadAbi,
          functionName,
          args: [input.managementAddress as Address],
        });

        return [field, normalizeAgentDetailField(result)] as const;
      } catch {
        return [field, null] as const;
      }
    }),
  );

  return {
    name: null,
    description: null,
    iconUrl: null,
    termsOfUseUrl: null,
    ...Object.fromEntries(entries),
  };
}

/**
 * Read official details for a set of agents, keyed by agent vault. Reads are
 * deduplicated per management address (multiple vaults can share one owner),
 * so each owner's registry entry is fetched at most once per refresh. Agents
 * with no resolvable management address map to `undefined` (details not
 * fetched — existing stored values are preserved on upsert).
 */
async function readAgentDetailsForAgents(input: {
  publicClient: ViemReadContractClient;
  agentOwnerRegistryAddress: EvmAddress;
  agents: readonly Readonly<{
    agentVault: EvmAddress;
    ownerManagementAddress: EvmAddress | null;
  }>[];
}): Promise<ReadonlyMap<EvmAddress, AgentDetails | undefined>> {
  const detailsByVault = new Map<EvmAddress, AgentDetails | undefined>();
  const detailsByOwner = new Map<EvmAddress, AgentDetails>();

  for (const { agentVault, ownerManagementAddress } of input.agents) {
    if (ownerManagementAddress === null) {
      detailsByVault.set(agentVault, undefined);
      continue;
    }

    let details = detailsByOwner.get(ownerManagementAddress);

    if (details === undefined) {
      details = await readAgentDetails({
        publicClient: input.publicClient,
        agentOwnerRegistryAddress: input.agentOwnerRegistryAddress,
        managementAddress: ownerManagementAddress,
      });
      detailsByOwner.set(ownerManagementAddress, details);
    }

    detailsByVault.set(agentVault, details);
  }

  return detailsByVault;
}

export async function refreshAgentInventory(
  input: RefreshAgentInventoryInput,
): Promise<AgentInventoryRefreshSummary> {
  const pageSize = validatedPageSize(input.pageSize);
  const refreshedAt = input.refreshedAt ?? new Date().toISOString();
  const detailedAvailableListSupported = assetManagerAbiHasFunction(
    "getAvailableAgentsDetailedList",
  );
  const availableAgentDetails = detailedAvailableListSupported
    ? await readAvailableAgentDetailedList({ ...input, pageSize })
    : [];
  const availableAgentVaults = detailedAvailableListSupported
    ? availableAgentDetails.map((detail) => detail.agentVault)
    : await readAvailableAgentVaults({ ...input, pageSize });
  const allAgentVaults =
    (input.includeAllAgents ?? true)
      ? await readAllAgentVaults({ ...input, pageSize })
      : [];
  const uniqueAgentVaults = uniqueEvmAddresses([
    ...allAgentVaults,
    ...availableAgentVaults,
  ]);
  const availableAgentVaultSet = new Set(availableAgentVaults);
  const allAgentVaultSet = new Set(allAgentVaults);
  const availableAgentDetailsByVault = new Map(
    availableAgentDetails.map((detail) => [detail.agentVault, detail]),
  );
  const agentInfoDetails = await readAgentInfos({
    publicClient: input.publicClient,
    assetManagerAddress: input.assetManagerAddress,
    agentVaults: uniqueAgentVaults,
  });
  const ownerByVault = new Map(
    agentInfoDetails.map((agentInfo) => [
      agentInfo.agentVault,
      resolveOwnerManagementAddress(
        agentInfo.raw,
        availableAgentDetailsByVault.get(agentInfo.agentVault),
      ),
    ]),
  );

  const includeAgentDetails = input.includeAgentDetails ?? true;
  const agentOwnerRegistryAddress = !includeAgentDetails
    ? null
    : (input.agentOwnerRegistryAddress ??
      (await readAgentOwnerRegistryAddress({
        publicClient: input.publicClient,
        assetManagerAddress: input.assetManagerAddress,
      })));
  const detailsByVault =
    agentOwnerRegistryAddress === null
      ? new Map<EvmAddress, AgentDetails | undefined>()
      : await readAgentDetailsForAgents({
          publicClient: input.publicClient,
          agentOwnerRegistryAddress,
          agents: agentInfoDetails.map((agentInfo) => ({
            agentVault: agentInfo.agentVault,
            ownerManagementAddress: ownerByVault.get(agentInfo.agentVault) ?? null,
          })),
        });

  const upsertInputs = agentInfoDetails.map((agentInfo) =>
    buildAgentUpsertInput({
      assetManagerAddress: input.assetManagerAddress,
      refreshedAt,
      agentInfo,
      availableDetail: availableAgentDetailsByVault.get(agentInfo.agentVault),
      listedByAvailableAgents: availableAgentVaultSet.has(agentInfo.agentVault),
      listedByAllAgents: allAgentVaultSet.has(agentInfo.agentVault),
      details: detailsByVault.get(agentInfo.agentVault),
    }),
  );

  const persistInventory = input.database.transaction(
    (agents: readonly UpsertAgentInput[]) => {
      for (const agent of agents) {
        upsertAgent(input.database, agent);
      }
    },
  );
  persistInventory(upsertInputs);

  return {
    assetManagerAddress: input.assetManagerAddress,
    refreshedAt,
    pageSize,
    detailedAvailableListSupported,
    availableAgentsRead: availableAgentVaults.length,
    availableAgentDetailsRead: availableAgentDetails.length,
    allAgentsRead: allAgentVaults.length,
    agentsRefreshed: agentInfoDetails.length,
    agentsPersisted: upsertInputs.length,
    agentOwnerRegistryAddress,
    agentDetailsRead: [...detailsByVault.values()].filter(
      (details) => details !== undefined,
    ).length,
  };
}

async function readAgentInfos(input: {
  publicClient: ViemReadContractClient;
  assetManagerAddress: EvmAddress;
  agentVaults: readonly EvmAddress[];
}): Promise<readonly AgentInfoDetail[]> {
  const details: AgentInfoDetail[] = [];

  for (const agentVault of input.agentVaults) {
    details.push(
      await readAgentInfo({
        publicClient: input.publicClient,
        assetManagerAddress: input.assetManagerAddress,
        agentVault,
      }),
    );
  }

  return details;
}

async function readPaginatedAssetManagerList<T>(
  input: PaginatedReadInput,
  functionName: string,
  parsePage: (
    result: unknown,
    functionName: string,
  ) => {
    items: readonly T[];
    totalLength: bigint;
  },
): Promise<readonly T[]> {
  const pageSize = validatedPageSize(input.pageSize);
  const items: T[] = [];
  let start = 0n;

  while (true) {
    const end = start + BigInt(pageSize);
    const result = await readAssetManagerContract(
      input.publicClient,
      input.assetManagerAddress,
      functionName,
      [start, end],
      `page ${start.toString()}-${end.toString()}`,
    );
    const page = parsePage(result, functionName);

    if (page.totalLength < 0n) {
      throw new Error(`${functionName} returned a negative total length`);
    }

    items.push(...page.items);

    if (end >= page.totalLength) {
      return items;
    }

    if (page.items.length === 0) {
      throw new Error(
        `${functionName} returned an empty page before total length ${page.totalLength.toString()}`,
      );
    }

    start = end;
  }
}

async function readAssetManagerContract(
  publicClient: ViemReadContractClient,
  assetManagerAddress: EvmAddress,
  functionName: string,
  args: readonly unknown[],
  context: string,
): Promise<unknown> {
  try {
    return await publicClient.readContract({
      address: assetManagerAddress as Address,
      abi: assetManagerReadAbi,
      functionName,
      args,
    });
  } catch (error) {
    throw new Error(
      `AssetManager ${functionName} read failed for ${context}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

function parseAddressListPage(
  result: unknown,
  functionName: string,
): { items: readonly EvmAddress[]; totalLength: bigint } {
  const { agents, totalLength } = parsePaginatedResult(result, functionName);
  return {
    items: agents.map((agentVault, index) =>
      normalizeEvmAddress(
        requireString(agentVault, `${functionName}[${index}]`),
      ),
    ),
    totalLength,
  };
}

function parseAvailableAgentDetailListPage(
  result: unknown,
  functionName: string,
): { items: readonly AvailableAgentDetail[]; totalLength: bigint } {
  const { agents, totalLength } = parsePaginatedResult(result, functionName);
  return {
    items: agents.map(parseAvailableAgentDetail),
    totalLength,
  };
}

function parsePaginatedResult(
  result: unknown,
  functionName: string,
): { agents: readonly unknown[]; totalLength: bigint } {
  const agents = readResultField(result, ["_agents", "agents"], 0);
  const totalLength = readResultField(
    result,
    ["_totalLength", "totalLength"],
    1,
  );

  if (!Array.isArray(agents)) {
    throw new Error(`${functionName} returned a non-array agents page`);
  }

  return {
    agents,
    totalLength: integerToBigint(totalLength, `${functionName} total length`),
  };
}

function parseAvailableAgentDetail(value: unknown): AvailableAgentDetail {
  const raw = namedTupleToRecord(value, availableAgentDetailFields);
  const agentVault = normalizeEvmAddress(
    requireString(raw.agentVault, "available agent vault"),
  );

  return {
    agentVault,
    ownerManagementAddress: optionalEvmAddress(
      raw.ownerManagementAddress,
      "available ownerManagementAddress",
    ),
    feeBIPS: optionalInteger(raw.feeBIPS, "available feeBIPS"),
    mintingVaultCollateralRatioBIPS: optionalInteger(
      raw.mintingVaultCollateralRatioBIPS,
      "available mintingVaultCollateralRatioBIPS",
    ),
    mintingPoolCollateralRatioBIPS: optionalInteger(
      raw.mintingPoolCollateralRatioBIPS,
      "available mintingPoolCollateralRatioBIPS",
    ),
    freeCollateralLots:
      optionalInteger(raw.freeCollateralLots, "available freeCollateralLots") ??
      0n,
    status: optionalInteger(raw.status, "available status"),
    raw,
  };
}

/**
 * Resolve an agent's owner management address, preferring the value from
 * `getAgentInfo` and falling back to the available-agents detailed list. This
 * address keys the agent's `AgentOwnerRegistry` entry, so it is shared by both
 * inventory persistence and official-details reads.
 */
function resolveOwnerManagementAddress(
  agentInfo: Readonly<Record<string, unknown>>,
  availableDetail: AvailableAgentDetail | undefined,
): EvmAddress | null {
  return (
    optionalEvmAddress(
      agentInfo.ownerManagementAddress,
      "ownerManagementAddress",
    ) ??
    availableDetail?.ownerManagementAddress ??
    null
  );
}

function buildAgentUpsertInput(input: {
  assetManagerAddress: EvmAddress;
  refreshedAt: IsoTimestamp;
  agentInfo: AgentInfoDetail;
  availableDetail: AvailableAgentDetail | undefined;
  listedByAvailableAgents: boolean;
  listedByAllAgents: boolean;
  details?: AgentDetails | undefined;
}): UpsertAgentInput {
  const agentInfo = input.agentInfo.raw;
  const owner = resolveOwnerManagementAddress(agentInfo, input.availableDetail);
  const paymentAddress = optionalString(
    agentInfo.underlyingAddressString,
    "underlyingAddressString",
  ) as XrplAddress | null;
  const publiclyAvailable = optionalBoolean(
    agentInfo.publiclyAvailable,
    "publiclyAvailable",
  );
  const availability =
    input.listedByAvailableAgents || publiclyAvailable === true
      ? "AVAILABLE"
      : "UNAVAILABLE";
  const feeBIPS =
    optionalInteger(agentInfo.feeBIPS, "feeBIPS") ??
    input.availableDetail?.feeBIPS ??
    null;
  const freeCollateralLots =
    optionalInteger(agentInfo.freeCollateralLots, "freeCollateralLots") ??
    input.availableDetail?.freeCollateralLots ??
    0n;
  const feeFields = {
    feeBIPS,
    poolFeeShareBIPS: optionalInteger(
      agentInfo.poolFeeShareBIPS,
      "poolFeeShareBIPS",
    ),
    redemptionPoolFeeShareBIPS: optionalInteger(
      agentInfo.redemptionPoolFeeShareBIPS,
      "redemptionPoolFeeShareBIPS",
    ),
    availableListFeeBIPS: input.availableDetail?.feeBIPS ?? null,
  };
  const collateralMetadata = buildCollateralMetadata(agentInfo);
  const rawInventory = {
    assetManagerAddress: input.assetManagerAddress,
    agentVault: input.agentInfo.agentVault,
    refreshedAt: input.refreshedAt,
    listedByAvailableAgents: input.listedByAvailableAgents,
    listedByAllAgents: input.listedByAllAgents,
    availableAgentDetail: input.availableDetail?.raw ?? null,
    agentInfo,
  };

  return {
    agentVault: input.agentInfo.agentVault,
    owner,
    paymentAddress,
    availability,
    redemptionFeeBips: bigintToSafeNumberOrNull(feeBIPS),
    availableLots: freeCollateralLots,
    ...(input.details === undefined ? {} : { details: input.details }),
    feeFieldsJson: stringifyJsonSafe(feeFields),
    collateralMetadataJson: stringifyJsonSafe(collateralMetadata),
    rawInventoryJson: stringifyJsonSafe(rawInventory),
    lastInventoryRefreshAt: input.refreshedAt,
    updatedAt: input.refreshedAt,
  };
}

function buildCollateralMetadata(agentInfo: Readonly<Record<string, unknown>>) {
  return {
    status: optionalInteger(agentInfo.status, "status"),
    ownerManagementAddress: optionalEvmAddress(
      agentInfo.ownerManagementAddress,
      "ownerManagementAddress",
    ),
    ownerWorkAddress: optionalEvmAddress(
      agentInfo.ownerWorkAddress,
      "ownerWorkAddress",
    ),
    collateralPool: optionalEvmAddress(
      agentInfo.collateralPool,
      "collateralPool",
    ),
    collateralPoolToken: optionalEvmAddress(
      agentInfo.collateralPoolToken,
      "collateralPoolToken",
    ),
    vaultCollateralToken: optionalEvmAddress(
      agentInfo.vaultCollateralToken,
      "vaultCollateralToken",
    ),
    poolWNatToken: optionalEvmAddress(agentInfo.poolWNatToken, "poolWNatToken"),
    mintingVaultCollateralRatioBIPS: optionalInteger(
      agentInfo.mintingVaultCollateralRatioBIPS,
      "mintingVaultCollateralRatioBIPS",
    ),
    mintingPoolCollateralRatioBIPS: optionalInteger(
      agentInfo.mintingPoolCollateralRatioBIPS,
      "mintingPoolCollateralRatioBIPS",
    ),
    freeCollateralLots: optionalInteger(
      agentInfo.freeCollateralLots,
      "freeCollateralLots",
    ),
    totalVaultCollateralWei: optionalInteger(
      agentInfo.totalVaultCollateralWei,
      "totalVaultCollateralWei",
    ),
    freeVaultCollateralWei: optionalInteger(
      agentInfo.freeVaultCollateralWei,
      "freeVaultCollateralWei",
    ),
    vaultCollateralRatioBIPS: optionalInteger(
      agentInfo.vaultCollateralRatioBIPS,
      "vaultCollateralRatioBIPS",
    ),
    totalPoolCollateralNATWei: optionalInteger(
      agentInfo.totalPoolCollateralNATWei,
      "totalPoolCollateralNATWei",
    ),
    freePoolCollateralNATWei: optionalInteger(
      agentInfo.freePoolCollateralNATWei,
      "freePoolCollateralNATWei",
    ),
    poolCollateralRatioBIPS: optionalInteger(
      agentInfo.poolCollateralRatioBIPS,
      "poolCollateralRatioBIPS",
    ),
    totalAgentPoolTokensWei: optionalInteger(
      agentInfo.totalAgentPoolTokensWei,
      "totalAgentPoolTokensWei",
    ),
    announcedVaultCollateralWithdrawalWei: optionalInteger(
      agentInfo.announcedVaultCollateralWithdrawalWei,
      "announcedVaultCollateralWithdrawalWei",
    ),
    announcedPoolTokensWithdrawalWei: optionalInteger(
      agentInfo.announcedPoolTokensWithdrawalWei,
      "announcedPoolTokensWithdrawalWei",
    ),
    freeAgentPoolTokensWei: optionalInteger(
      agentInfo.freeAgentPoolTokensWei,
      "freeAgentPoolTokensWei",
    ),
    mintedUBA: optionalInteger(agentInfo.mintedUBA, "mintedUBA"),
    reservedUBA: optionalInteger(agentInfo.reservedUBA, "reservedUBA"),
    redeemingUBA: optionalInteger(agentInfo.redeemingUBA, "redeemingUBA"),
    poolRedeemingUBA: optionalInteger(
      agentInfo.poolRedeemingUBA,
      "poolRedeemingUBA",
    ),
    dustUBA: optionalInteger(agentInfo.dustUBA, "dustUBA"),
    underlyingBalanceUBA: optionalInteger(
      agentInfo.underlyingBalanceUBA,
      "underlyingBalanceUBA",
    ),
    requiredUnderlyingBalanceUBA: optionalInteger(
      agentInfo.requiredUnderlyingBalanceUBA,
      "requiredUnderlyingBalanceUBA",
    ),
    freeUnderlyingBalanceUBA: optionalInteger(
      agentInfo.freeUnderlyingBalanceUBA,
      "freeUnderlyingBalanceUBA",
    ),
    announcedUnderlyingWithdrawalId: optionalInteger(
      agentInfo.announcedUnderlyingWithdrawalId,
      "announcedUnderlyingWithdrawalId",
    ),
    buyFAssetByAgentFactorBIPS: optionalInteger(
      agentInfo.buyFAssetByAgentFactorBIPS,
      "buyFAssetByAgentFactorBIPS",
    ),
    liquidationStartTimestamp: optionalInteger(
      agentInfo.liquidationStartTimestamp,
      "liquidationStartTimestamp",
    ),
    maxLiquidationAmountUBA: optionalInteger(
      agentInfo.maxLiquidationAmountUBA,
      "maxLiquidationAmountUBA",
    ),
    liquidationPaymentFactorVaultBIPS: optionalInteger(
      agentInfo.liquidationPaymentFactorVaultBIPS,
      "liquidationPaymentFactorVaultBIPS",
    ),
    liquidationPaymentFactorPoolBIPS: optionalInteger(
      agentInfo.liquidationPaymentFactorPoolBIPS,
      "liquidationPaymentFactorPoolBIPS",
    ),
    poolExitCollateralRatioBIPS: optionalInteger(
      agentInfo.poolExitCollateralRatioBIPS,
      "poolExitCollateralRatioBIPS",
    ),
  };
}

function namedTupleToRecord(
  value: unknown,
  fields: readonly IndexedTupleField[],
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    fields.map(([name, index]) => [
      name,
      readResultField(value, [name], index) ?? null,
    ]),
  );
}

function readResultField(
  result: unknown,
  fieldNames: readonly string[],
  index: number,
): unknown {
  if (result !== null && typeof result === "object") {
    const record = result as Record<string, unknown>;

    for (const fieldName of fieldNames) {
      if (fieldName in record) {
        return record[fieldName];
      }
    }
  }

  if (Array.isArray(result)) {
    return result[index];
  }

  return undefined;
}

function uniqueEvmAddresses(
  addresses: readonly EvmAddress[],
): readonly EvmAddress[] {
  const uniqueAddresses: EvmAddress[] = [];
  const seen = new Set<EvmAddress>();

  for (const address of addresses) {
    const normalizedAddress = normalizeEvmAddress(address);

    if (!seen.has(normalizedAddress)) {
      uniqueAddresses.push(normalizedAddress);
      seen.add(normalizedAddress);
    }
  }

  return uniqueAddresses;
}

function optionalEvmAddress(
  value: unknown,
  fieldName: string,
): EvmAddress | null {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeEvmAddress(requireString(value, fieldName));
}

function optionalString(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireString(value, fieldName);
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }

  return value;
}

function optionalBoolean(value: unknown, fieldName: string): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return value;
}

function optionalInteger(value: unknown, fieldName: string): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }

  return integerToBigint(value, fieldName);
}

function integerToBigint(value: unknown, fieldName: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value);
  }

  throw new Error(`${fieldName} must be an integer`);
}

function bigintToSafeNumberOrNull(value: bigint | null): number | null {
  if (
    value === null ||
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return null;
  }

  return Number(value);
}

function stringifyJsonSafe(value: unknown): string {
  const serialized = JSON.stringify(serializeBigints(value));

  if (serialized === undefined) {
    throw new Error("Inventory payload could not be serialized as JSON");
  }

  return serialized;
}

function validatedPageSize(pageSize = defaultAgentInventoryPageSize): number {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new Error(
      "Agent inventory page size must be a positive safe integer",
    );
  }

  return pageSize;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
