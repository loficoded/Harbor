import type { Abi, AbiFragment } from "./types.js";

type NamedAbiFragment = Extract<
  AbiFragment,
  { readonly type: "function" | "event" }
> & {
  readonly name: string;
  readonly type: "function" | "event";
};

export const requiredHarborRedeemerFunctions = [
  "FXRP_ASSET_MANAGER_REGISTRY_NAME",
  "assetDecimals",
  "assetManagerAddress",
  "defaultKeeperExecutor",
  "executeDefault",
  "fAssetTokenAddress",
  "lotSizeUBA",
  "owner",
  "setDefaultKeeperExecutor",
  "transferOwnership",
] as const;

export const requiredHarborRedeemerEvents = [
  "DefaultKeeperExecutorUpdated",
  "OwnershipTransferred",
  "RedemptionDefaultForwarded",
] as const;

export const findNamedAbiFragment = (
  abi: Abi,
  type: "function" | "event",
  name: string,
): NamedAbiFragment | undefined =>
  abi.find(
    (fragment): fragment is NamedAbiFragment =>
      fragment.type === type && "name" in fragment && fragment.name === name,
  );

export const missingHarborRedeemerAbiFragments = (abi: Abi): string[] => {
  const missingFunctions = requiredHarborRedeemerFunctions
    .filter((name) => findNamedAbiFragment(abi, "function", name) === undefined)
    .map((name) => `function ${name}`);

  const missingEvents = requiredHarborRedeemerEvents
    .filter((name) => findNamedAbiFragment(abi, "event", name) === undefined)
    .map((name) => `event ${name}`);

  return [...missingFunctions, ...missingEvents];
};
