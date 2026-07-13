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
 * wagmi so every branch (amount validation, lot validation, UBA math, approval
 * gating, executor resolution, receipt parsing, routing) is directly unit
 * testable. The container component wires wallet/chain state into these
 * functions.
 *
 * Protocol model (see the official Flare FAssets redemption docs):
 * `AssetManager.redeemAmount(amountUBA, xrplAddress, executor)` redeems an
 * arbitrary FXRP amount, while `redeem(lots, …)` redeems whole lots. In both
 * cases the FAssets protocol selects redemption tickets FIFO from the front of
 * the queue — the redeemer never chooses an agent. This module therefore
 * carries no agent-selection concept at all.
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
// Redeem input mode
// ---------------------------------------------------------------------------

/**
 * How the redeemer expresses the amount to redeem.
 *
 * - `amount`: an arbitrary FXRP amount, submitted via `redeemAmount`. This is
 *   the primary, modern flow — FAssets supports redeeming any amount, not only
 *   whole lots (https://dev.flare.network/fassets/redemption#redeem-any-amount).
 * - `lots`: a whole number of lots, submitted via the classic `redeem`. Kept
 *   as an optional advanced mode for users who think in lots; it is no longer
 *   the only user-facing path.
 */
export type RedeemMode = "amount" | "lots";

export const DEFAULT_REDEEM_MODE: RedeemMode = "amount";

// ---------------------------------------------------------------------------
// Arbitrary amount (primary flow: redeemAmount)
// ---------------------------------------------------------------------------

export type AmountParseResult = Readonly<{
  /** Parsed amount in UBA (FAsset base units), or `null` when empty/invalid. */
  amountUba: bigint | null;
  /** User-facing error, or `null` for empty (quiet) and valid inputs. */
  error: string | null;
}>;

/**
 * Parse a raw arbitrary-amount input (e.g. `"2.37"`) into an exact UBA bigint.
 *
 * Correctness notes:
 * - The conversion is done with bigint arithmetic against the FXRP decimals, so
 *   no floating-point rounding is ever applied to a token amount.
 * - Empty input is not an error (the field is simply incomplete).
 * - Zero, negative (the leading `-` is rejected by the numeric shape), non-
 *   numeric, and more-than-`decimals` fractional digits are all errors with a
 *   clear, user-facing message.
 */
export function parseRedeemAmount(
  raw: string,
  decimals: number = FXRP_DECIMALS,
): AmountParseResult {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return { amountUba: null, error: null };
  }

  // Accept only a plain decimal number: digits, an optional single dot, digits.
  // No sign, no exponent, no thousands separators. `"."` alone is rejected.
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === ".") {
    return { amountUba: null, error: "Enter a valid FXRP amount." };
  }

  const dotIndex = trimmed.indexOf(".");
  const wholePart = dotIndex === -1 ? trimmed : trimmed.slice(0, dotIndex);
  const fractionPart = dotIndex === -1 ? "" : trimmed.slice(dotIndex + 1);

  if (fractionPart.length > decimals) {
    return {
      amountUba: null,
      error: `${FXRP_LABEL} supports up to ${decimals} decimal places.`,
    };
  }

  const wholeUnits = wholePart === "" ? 0n : BigInt(wholePart);
  const paddedFraction = fractionPart.padEnd(decimals, "0");
  const fractionUnits = paddedFraction === "" ? 0n : BigInt(paddedFraction);
  const amountUba = wholeUnits * 10n ** BigInt(decimals) + fractionUnits;

  if (amountUba <= 0n) {
    return { amountUba: null, error: "Enter an amount greater than zero." };
  }

  return { amountUba, error: null };
}

// ---------------------------------------------------------------------------
// Lot count (optional advanced mode: redeem)
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
// Executor (Prompt #04 path: direct AssetManager redeem, Harbor as executor)
// ---------------------------------------------------------------------------

export type ExecutorResolution = Readonly<{
  /** Executor passed to the redeem call. The Harbor keeper when configured. */
  executor: EvmAddress;
  /** Native executor fee (wei) sent as `msg.value`. */
  executorFeeWei: bigint;
  /** True when a Harbor executor address is configured. */
  harborManaged: boolean;
}>;

/**
 * Resolve the executor and its fee for a redeem call.
 *
 * Prompt #04 selected the direct `AssetManager` redeem path with the Harbor
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
 * logs. A single redeem can be filled from multiple agents' tickets (the
 * protocol assigns them FIFO), emitting several `RedemptionRequested` events,
 * so this returns every distinct id in emission order. Logs that are not this
 * event (or cannot be decoded against the AssetManager events ABI) are skipped.
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
}>;

/**
 * Build the status route for a submitted redemption. Navigation targets the
 * first request id; any additional ids are preserved in the `more` query param
 * (comma-separated) so every emitted request can be tracked. The redeem
 * transaction hash is preserved when provided. Returns `null` when there are no
 * request ids to route to.
 *
 * No agent is carried in the route: the FAssets protocol assigns agents FIFO,
 * so the assigned agent(s) are read from indexed protocol data on the status
 * page rather than passed from the submission.
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
  /** Amount to redeem in UBA, or `null` when the input is empty/invalid. */
  requiredUba: bigint | null;
  /** Validation error for the amount/lots input, or `null`. */
  inputError: string | null;
  addressValid: boolean;
  /** Whether the on-chain balance has been read yet. */
  balanceKnown: boolean;
  sufficientBalance: boolean;
}>;

/**
 * Reason the primary approve/redeem action must stay disabled, or `null` when
 * the form is ready to proceed. Ordered from the most fundamental prerequisite
 * (wallet) to the most specific (balance) so the surfaced message is the next
 * actionable step. The wording is amount-based since arbitrary amount is the
 * primary flow; the lot mode surfaces its own input error via `inputError`.
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
  if (state.inputError !== null) {
    return state.inputError;
  }
  if (state.requiredUba === null) {
    return "Enter an amount to redeem.";
  }
  if (!state.addressValid) {
    return "Enter a valid XRPL destination address.";
  }
  if (state.balanceKnown && !state.sufficientBalance) {
    return "Insufficient FXRP balance for this amount.";
  }
  return null;
}
