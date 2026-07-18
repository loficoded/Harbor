import {
  coston2FAssetTokenAddress,
  coston2FxrpAsset,
  coston2FxrpAssetManagerAddress,
  iAssetManagerEventsAbi,
  type EvmAddress,
} from "@harbor/protocol";
import { destinationTagMax, normalizeDestinationTag } from "@harbor/shared";
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
 * wagmi so every branch (amount validation, UBA math, approval gating, executor
 * resolution, receipt parsing, routing) is directly unit testable. The
 * container component wires wallet/chain state into these functions.
 *
 * Protocol model (see the official Flare FAssets redemption docs):
 * `AssetManager.redeemAmount(amountUBA, xrplAddress, executor)` redeems an
 * arbitrary FXRP amount. The redeemer always enters an amount — there is no
 * lot-based input path. The FAssets protocol selects redemption tickets FIFO
 * from the front of the queue, so the redeemer never chooses an agent. This
 * module therefore carries no agent-selection concept at all.
 */

/** FXRP FAsset ERC-20 decimals (base units == underlying UBA / XRP drops). */
export const FXRP_DECIMALS = coston2FxrpAsset.decimals;

/** Display label for the asset (the token symbol is the test-net `FTestXRP`). */
export const FXRP_LABEL = coston2FxrpAsset.name;

/** Coston2 FXRP AssetManager — the redeem target and approval spender. */
export const FXRP_ASSET_MANAGER_ADDRESS: EvmAddress =
  coston2FxrpAssetManagerAddress;

/** Coston2 FXRP FAsset token — the ERC-20 we read balance/allowance from. */
export const FXRP_TOKEN_ADDRESS: EvmAddress = coston2FAssetTokenAddress;

// ---------------------------------------------------------------------------
// Redeem amount (redeemAmount)
//
// FAssets supports redeeming any amount, not only whole lots
// (https://dev.flare.network/fassets/redemption#redeem-any-amount). The console
// always redeems an arbitrary FXRP amount via `redeemAmount`; there is no
// lot-based input path.
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
// Destination tag (redeem-by-tag)
//
// FAssets exposes `redeemWithTag(amountUBA, address, executor, destinationTag)`
// for XRP redemptions that require a destination tag (exchanges/custodians). An
// empty tag input means "no tag" → the standard `redeemAmount` path. A
// user-supplied tag (including `0`) means the tag path. The tag must fit a
// uint32 (the on-chain `DestinationTagTooBig` revert bound).
// ---------------------------------------------------------------------------

export type DestinationTagParseResult = Readonly<{
  /** Parsed uint32 tag, or `null` when the input is empty (→ standard redeem). */
  tag: bigint | null;
  /** User-facing error, or `null` for empty (quiet) and valid inputs. */
  error: string | null;
}>;

/**
 * Parse a raw destination-tag input into an exact uint32 bigint. Empty input is
 * not an error (it means "no tag" → standard `redeemAmount`); `0` is a valid
 * tag and selects `redeemWithTag`. Anything non-numeric or ≥ 2**32 is an error.
 *
 * Delegates the uint32 bound check to the shared `normalizeDestinationTag`
 * primitive (one source of truth for tag parsing across the app), keeping only
 * the user-facing error-message wrapper here.
 */
export function parseDestinationTag(raw: string): DestinationTagParseResult {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return { tag: null, error: null };
  }

  if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
    return { tag: null, error: "Destination tag must be a whole number." };
  }

  const tag = normalizeDestinationTag(trimmed);
  if (tag === null) {
    return {
      tag: null,
      error: `Destination tag must fit in 32 bits (at most ${destinationTagMax}).`,
    };
  }

  return { tag, error: null };
}

/** The redeem function + args derived from the (optional) destination tag. */
export type RedeemCallArgs =
  | Readonly<{
      functionName: "redeemAmount";
      args: readonly [bigint, string, EvmAddress];
    }>
  | Readonly<{
      functionName: "redeemWithTag";
      args: readonly [bigint, string, EvmAddress, bigint];
    }>;

/**
 * Build the AssetManager redeem call from the parsed amount, validated XRPL
 * address, resolved executor, and optional destination tag. Empty tag ⇒
 * `redeemAmount`; present tag ⇒ `redeemWithTag(amount, address, executor, tag)`.
 */
export function buildRedeemCallArgs(
  input: Readonly<{
    amountUba: bigint;
    xrplAddress: string;
    executor: EvmAddress;
    destinationTag: bigint | null;
  }>,
): RedeemCallArgs {
  if (input.destinationTag === null) {
    return {
      functionName: "redeemAmount",
      args: [input.amountUba, input.xrplAddress, input.executor],
    };
  }

  return {
    functionName: "redeemWithTag",
    args: [
      input.amountUba,
      input.xrplAddress,
      input.executor,
      input.destinationTag,
    ],
  };
}

// ---------------------------------------------------------------------------
// Amount formatting
// ---------------------------------------------------------------------------

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
 * Extract the redemption request ids from a transaction receipt's logs. A
 * single redeem can be filled from multiple agents' tickets (the protocol
 * assigns them FIFO), emitting several `RedemptionRequested` (standard path)
 * or `RedemptionWithTagRequested` (tag path) events, so this returns every
 * distinct id in emission order. A tag redemption emits
 * `RedemptionWithTagRequested` — NOT `RedemptionRequested` — so both event
 * names are accepted. Logs that are neither (or cannot be decoded against the
 * AssetManager events ABI) are skipped.
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

    if (decoded === null) {
      continue;
    }

    if (
      decoded.eventName !== "RedemptionRequested" &&
      decoded.eventName !== "RedemptionWithTagRequested"
    ) {
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
  /** Validation error for the amount input, or `null`. */
  inputError: string | null;
  addressValid: boolean;
  /** Validation error for the destination-tag input, or `null`. */
  tagError: string | null;
  /**
   * Whether the user supplied a destination tag (i.e. requested the
   * `redeemWithTag` lane). A present tag — including `0` — is `true`; an empty
   * input is `false`.
   */
  tagRequested: boolean;
  /**
   * On-chain `redeemWithTagSupported()` capability. `true`/`false` once the read
   * resolves, or `undefined` while unknown/loading. A requested tag is only
   * blocked when this is explicitly `false`, so a transient `undefined` never
   * flickers the gate.
   */
  tagSupported: boolean | undefined;
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
  if (state.inputError !== null) {
    return state.inputError;
  }
  if (state.requiredUba === null) {
    return "Enter an amount to redeem.";
  }
  if (!state.addressValid) {
    return "Enter a valid XRPL destination address.";
  }
  if (state.tagError !== null) {
    return state.tagError;
  }
  if (state.tagRequested && state.tagSupported === false) {
    return "This AssetManager does not support destination-tag redemptions.";
  }
  if (state.balanceKnown && !state.sufficientBalance) {
    return "Insufficient FXRP balance for this amount.";
  }
  return null;
}
