import {
  coston2FAssetTokenAddress,
  coston2FxrpAsset,
  coston2FxrpAssetManagerAddress,
  iAssetManagerEventsAbi,
  type EvmAddress,
} from "@harbor/protocol";
import {
  decodeEventLog,
  formatUnits,
  getAddress,
  isAddress,
  zeroAddress,
  type Abi,
  type Hex,
} from "viem";

/**
 * Pure redemption domain helpers for the `/` console. Kept free of React and
 * wagmi so every branch (lot validation, amount math, approval gating, executor
 * resolution, receipt parsing, routing) is directly unit testable. The
 * container component wires wallet/chain state into these functions.
 */

/** FXRP FAsset ERC-20 decimals (base units == underlying UBA / XRP drops). */
export const FXRP_DECIMALS = coston2FxrpAsset.decimals;

/** Display label for the asset (the token symbol is the test-net `FTestXRP`). */
export const FXRP_LABEL = coston2FxrpAsset.name;

/** Fallback lot size in UBA when the AssetManager settings are unavailable. */
export const DEFAULT_FXRP_LOT_SIZE_UBA = coston2FxrpAsset.lotSizeUBA;

/** Coston2 FXRP AssetManager — the redeem target and approval spender. */
export const FXRP_ASSET_MANAGER_ADDRESS: EvmAddress =
  coston2FxrpAssetManagerAddress;

/** Coston2 FXRP FAsset token — the ERC-20 we read balance/allowance from. */
export const FXRP_TOKEN_ADDRESS: EvmAddress = coston2FAssetTokenAddress;

// ---------------------------------------------------------------------------
// Lot count
// ---------------------------------------------------------------------------

export type LotParseResult = Readonly<{
  /** Parsed positive lot count, or `null` when empty/invalid. */
  lots: bigint | null;
  /** User-facing error, or `null` for empty (quiet) and valid inputs. */
  error: string | null;
}>;

/**
 * Parse a raw lot-count input. Empty is not an error (the field is simply
 * incomplete); non-integers and non-positive values are.
 */
export function parseLotCount(raw: string): LotParseResult {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return { lots: null, error: null };
  }

  if (!/^\d+$/.test(trimmed)) {
    return { lots: null, error: "Enter a whole number of lots." };
  }

  const lots = BigInt(trimmed);
  if (lots <= 0n) {
    return { lots: null, error: "Enter at least one lot." };
  }

  return { lots, error: null };
}

// ---------------------------------------------------------------------------
// Amount math
// ---------------------------------------------------------------------------

type LotSizeSettings = Readonly<{
  lotSizeAMG: bigint;
  assetMintingGranularityUBA: bigint;
}>;

/**
 * Resolve the lot size in UBA from live AssetManager settings when present,
 * falling back to the protocol helper constant. `lotSizeUBA = lotSizeAMG ×
 * assetMintingGranularityUBA`.
 */
export function lotSizeUbaFromSettings(
  settings: LotSizeSettings | undefined,
  fallback: bigint = DEFAULT_FXRP_LOT_SIZE_UBA,
): bigint {
  if (settings === undefined) {
    return fallback;
  }

  const derived = settings.lotSizeAMG * settings.assetMintingGranularityUBA;
  return derived > 0n ? derived : fallback;
}

/** Total UBA (== FAsset base units) required to redeem `lots` lots. */
export function lotsToUba(lots: bigint, lotSizeUba: bigint): bigint {
  return lots * lotSizeUba;
}

/** Format a UBA/base-unit amount as a human FXRP string. */
export function formatFxrpAmount(
  uba: bigint,
  decimals: number = FXRP_DECIMALS,
): string {
  return formatUnits(uba, decimals);
}

// ---------------------------------------------------------------------------
// Balance & approval
// ---------------------------------------------------------------------------

/** Whether a known balance covers the required amount. */
export function hasSufficientBalance(
  balance: bigint | undefined,
  requiredUba: bigint,
): boolean {
  if (requiredUba <= 0n || balance === undefined) {
    return false;
  }
  return balance >= requiredUba;
}

/**
 * Whether the FAsset must be approved before redeeming. An unknown allowance is
 * treated as "approval required" so the UI never lets a redeem fail on a
 * missing allowance.
 */
export function isApprovalRequired(
  allowance: bigint | undefined,
  requiredUba: bigint,
): boolean {
  if (requiredUba <= 0n) {
    return false;
  }
  if (allowance === undefined) {
    return true;
  }
  return allowance < requiredUba;
}

// ---------------------------------------------------------------------------
// Executor (Prompt #04 path: direct AssetManager.redeem, Harbor as executor)
// ---------------------------------------------------------------------------

export type ExecutorResolution = Readonly<{
  /** Executor passed to `redeem`. The Harbor keeper when configured. */
  executor: EvmAddress;
  /** Native executor fee (wei) sent as `msg.value`. */
  executorFeeWei: bigint;
  /** True when a Harbor executor address is configured. */
  harborManaged: boolean;
}>;

/**
 * Resolve the executor and its fee for a `redeem` call.
 *
 * Prompt #04 selected the direct `AssetManager.redeem` path with the Harbor
 * keeper as executor, so default recovery stays permissionless via Harbor. When
 * a Harbor contract address is configured we pass it as executor and attach the
 * configurable default fee; otherwise the redemption is self-managed with a
 * zero executor and (as FAssets requires) a zero fee.
 */
export function resolveExecutor(
  contractAddress: string | null,
  defaultFeeWei: bigint,
): ExecutorResolution {
  if (contractAddress !== null && isAddress(contractAddress)) {
    return {
      executor: getAddress(contractAddress),
      executorFeeWei: defaultFeeWei > 0n ? defaultFeeWei : 0n,
      harborManaged: true,
    };
  }

  return {
    executor: zeroAddress,
    executorFeeWei: 0n,
    harborManaged: false,
  };
}

// ---------------------------------------------------------------------------
// Receipt parsing
// ---------------------------------------------------------------------------

export type RedemptionLogInput = Readonly<{
  data: Hex;
  topics: readonly Hex[];
}>;

/**
 * Extract the `RedemptionRequested` request ids from a transaction receipt's
 * logs. A single `redeem` can be filled from multiple agents' tickets, emitting
 * several `RedemptionRequested` events, so this returns every distinct id in
 * emission order. Logs that are not this event (or cannot be decoded against
 * the AssetManager events ABI) are skipped.
 */
export function parseRedemptionRequestIds(
  logs: readonly RedemptionLogInput[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const log of logs) {
    if (log.topics.length === 0) {
      continue;
    }

    let decoded: { eventName: string; args: unknown } | null = null;
    try {
      decoded = decodeEventLog({
        abi: iAssetManagerEventsAbi as unknown as Abi,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      }) as { eventName: string; args: unknown };
    } catch {
      decoded = null;
    }

    if (decoded === null || decoded.eventName !== "RedemptionRequested") {
      continue;
    }

    const args = decoded.args as Record<string, unknown> | undefined;
    const requestId = args?.["requestId"];
    if (typeof requestId !== "bigint") {
      continue;
    }

    const id = requestId.toString();
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export type StatusRouteParams = Readonly<{
  requestIds: readonly string[];
  transactionHash?: string | null;
  agentVault?: string | null;
}>;

/**
 * Build the status route for a submitted redemption. Navigation targets the
 * first request id; any additional ids are preserved in the `more` query param
 * (comma-separated) so Prompt #18 can track every emitted request. The
 * transaction hash and preferred agent are preserved when provided. Returns
 * `null` when there are no request ids to route to.
 */
export function buildStatusPath(params: StatusRouteParams): string | null {
  const [first, ...rest] = params.requestIds;
  if (first === undefined) {
    return null;
  }

  const query = new URLSearchParams();
  if (rest.length > 0) {
    query.set("more", rest.join(","));
  }
  if (
    params.transactionHash !== undefined &&
    params.transactionHash !== null &&
    params.transactionHash !== ""
  ) {
    query.set("tx", params.transactionHash);
  }
  if (
    params.agentVault !== undefined &&
    params.agentVault !== null &&
    params.agentVault !== ""
  ) {
    query.set("agent", params.agentVault);
  }

  const suffix = query.toString();
  const base = `/status/${encodeURIComponent(first)}`;
  return suffix === "" ? base : `${base}?${suffix}`;
}

// ---------------------------------------------------------------------------
// Readiness gate
// ---------------------------------------------------------------------------

export type RedemptionReadiness = Readonly<{
  isConnected: boolean;
  correctNetwork: boolean;
  lots: bigint | null;
  lotError: string | null;
  addressValid: boolean;
  /** Whether the on-chain balance has been read yet. */
  balanceKnown: boolean;
  sufficientBalance: boolean;
}>;

/**
 * Reason the primary approve/redeem action must stay disabled, or `null` when
 * the form is ready to proceed. Ordered from the most fundamental prerequisite
 * (wallet) to the most specific (balance) so the surfaced message is the next
 * actionable step.
 */
export function redemptionBlockedReason(
  state: RedemptionReadiness,
): string | null {
  if (!state.isConnected) {
    return "Connect a wallet to redeem.";
  }
  if (!state.correctNetwork) {
    return "Switch to Coston2 to redeem.";
  }
  if (state.lotError !== null) {
    return state.lotError;
  }
  if (state.lots === null) {
    return "Enter a lot count.";
  }
  if (!state.addressValid) {
    return "Enter a valid XRPL destination address.";
  }
  if (state.balanceKnown && !state.sufficientBalance) {
    return "Insufficient FXRP balance for this lot count.";
  }
  return null;
}
