import {
  referencedPaymentNonexistenceResponseAbi,
  xrpPaymentNonexistenceResponseAbi,
} from "@harbor/protocol";
import type { RedemptionKind, SerializedFdcProofRecord } from "@harbor/shared";
import { decodeAbiParameters, getAddress, isAddress, type Hex } from "viem";

/**
 * Pure proof-handling helpers for the permissionless self-recovery flow
 * (Prompt #20). Everything here is free of React and wagmi so proof decoding,
 * calldata validation, the `executeDefault` argument assembly, and the panel
 * state machine are all directly unit testable.
 *
 * Contract call: `HarborRedeemer.executeDefault(proof, redemptionRequestId)`
 * (the permissionless default path selected in Prompt #04). Harbor forwards the
 * call to `AssetManager.redemptionPaymentDefault` and returns any executor fee
 * to `msg.sender`, so anyone — not just the original redeemer — can submit it.
 *
 * Proof data source: the already-prepared FDC proof exposed by
 * `GET /redemptions/:id` (`fdcProofs[]`). Each record carries the ABI-encoded
 * `IReferencedPaymentNonexistence.Response` tuple as `responseBody` plus the
 * `merkleProof` array. This module decodes `responseBody` with the protocol's
 * canonical Response ABI — the mirror of how the backend keeper assembles the
 * same calldata in `services/api/src/keeper/defaultExecutor.ts` — so the UI
 * never fabricates proof data and never accepts arbitrary user-supplied JSON.
 */

const EXECUTE_DEFAULT_FUNCTION_NAME = "executeDefault" as const;
const EXECUTE_XRP_DEFAULT_FUNCTION_NAME = "executeXrpDefault" as const;

export { EXECUTE_DEFAULT_FUNCTION_NAME, EXECUTE_XRP_DEFAULT_FUNCTION_NAME };

/** viem parameter descriptor for the encoded `Response` tuple. */
const RESPONSE_TUPLE_ABI = [
  { type: "tuple", components: referencedPaymentNonexistenceResponseAbi },
] as const;

/** viem parameter descriptor for the encoded XRP `Response` tuple. */
const XRP_RESPONSE_TUPLE_ABI = [
  { type: "tuple", components: xrpPaymentNonexistenceResponseAbi },
] as const;

// ---------------------------------------------------------------------------
// Decoded proof shapes (mirror IReferencedPaymentNonexistence.Proof)
// ---------------------------------------------------------------------------

export type ExecuteDefaultRequestBody = Readonly<{
  minimalBlockNumber: bigint;
  deadlineBlockNumber: bigint;
  deadlineTimestamp: bigint;
  destinationAddressHash: Hex;
  amount: bigint;
  standardPaymentReference: Hex;
  checkSourceAddresses: boolean;
  sourceAddressesRoot: Hex;
}>;

export type ExecuteDefaultResponseBody = Readonly<{
  minimalBlockTimestamp: bigint;
  firstOverflowBlockNumber: bigint;
  firstOverflowBlockTimestamp: bigint;
}>;

export type ExecuteDefaultResponseData = Readonly<{
  attestationType: Hex;
  sourceId: Hex;
  votingRound: bigint;
  lowestUsedTimestamp: bigint;
  requestBody: ExecuteDefaultRequestBody;
  responseBody: ExecuteDefaultResponseBody;
}>;

/** The `proof` (first) argument to `HarborRedeemer.executeDefault`. */
export type ExecuteDefaultProofArg = Readonly<{
  merkleProof: readonly Hex[];
  data: ExecuteDefaultResponseData;
}>;

/** Positional args for `executeDefault(proof, redemptionRequestId)`. */
export type ExecuteDefaultArgs = readonly [ExecuteDefaultProofArg, bigint];

export type BuildProofResult<TArgs = ExecuteDefaultArgs> =
  | Readonly<{ ok: true; args: TArgs }>
  | Readonly<{ ok: false; issues: readonly string[] }>;

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------

/** A 0x-prefixed 32-byte hex string. */
export function isBytes32(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Parse a redemption request id into a non-negative `uint256` bigint, or
 * `null` when it is not a plain non-negative integer string. FAssets request
 * ids are decimal integers; anything else must not be encoded into a call.
 */
export function parseRedemptionRequestId(requestId: string): bigint | null {
  const trimmed = requestId.trim();
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
    return null;
  }
  return BigInt(trimmed);
}

function isUnsignedBigint(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n;
}

// ---------------------------------------------------------------------------
// Response decoding + validation
// ---------------------------------------------------------------------------

type DecodeResult =
  | Readonly<{ ok: true; data: ExecuteDefaultResponseData }>
  | Readonly<{ ok: false; issue: string }>;

/**
 * Decode the ABI-encoded `responseBody` hex into the structured `Response`
 * data. Returns a typed issue (never throws) when the hex is missing or is not
 * a valid encoded Response tuple, so a malformed proof is rejected *before* any
 * transaction encoding rather than surfacing as an opaque wallet error.
 */
export function decodeProofResponseBody(responseBody: unknown): DecodeResult {
  if (
    typeof responseBody !== "string" ||
    !/^0x[0-9a-fA-F]*$/.test(responseBody)
  ) {
    return { ok: false, issue: "responseBody is not a hex string" };
  }

  let decoded: unknown;
  try {
    decoded = decodeAbiParameters(RESPONSE_TUPLE_ABI, responseBody as Hex)[0];
  } catch {
    return {
      ok: false,
      issue: "responseBody is not a valid encoded FDC Response tuple",
    };
  }

  const issues = validateResponseData(decoded);
  if (issues.length > 0) {
    return { ok: false, issue: issues[0] ?? "responseBody is malformed" };
  }

  return { ok: true, data: decoded as ExecuteDefaultResponseData };
}

/** Validate the decoded Response tuple field-by-field. */
export function validateResponseData(value: unknown): readonly string[] {
  const issues: string[] = [];
  if (typeof value !== "object" || value === null) {
    return ["Response data is not an object"];
  }
  const data = value as Record<string, unknown>;

  if (!isBytes32(data["attestationType"])) {
    issues.push("attestationType must be bytes32");
  }
  if (!isBytes32(data["sourceId"])) {
    issues.push("sourceId must be bytes32");
  }
  if (!isUnsignedBigint(data["votingRound"])) {
    issues.push("votingRound must be a non-negative integer");
  }
  if (!isUnsignedBigint(data["lowestUsedTimestamp"])) {
    issues.push("lowestUsedTimestamp must be a non-negative integer");
  }

  const requestBody = data["requestBody"];
  if (typeof requestBody !== "object" || requestBody === null) {
    issues.push("requestBody is missing");
  } else {
    const rb = requestBody as Record<string, unknown>;
    for (const field of [
      "minimalBlockNumber",
      "deadlineBlockNumber",
      "deadlineTimestamp",
      "amount",
    ] as const) {
      if (!isUnsignedBigint(rb[field])) {
        issues.push(`requestBody.${field} must be a non-negative integer`);
      }
    }
    if (!isBytes32(rb["destinationAddressHash"])) {
      issues.push("requestBody.destinationAddressHash must be bytes32");
    }
    if (!isBytes32(rb["standardPaymentReference"])) {
      issues.push("requestBody.standardPaymentReference must be bytes32");
    }
    if (!isBytes32(rb["sourceAddressesRoot"])) {
      issues.push("requestBody.sourceAddressesRoot must be bytes32");
    }
    if (typeof rb["checkSourceAddresses"] !== "boolean") {
      issues.push("requestBody.checkSourceAddresses must be a boolean");
    }
  }

  const responseBody = data["responseBody"];
  if (typeof responseBody !== "object" || responseBody === null) {
    issues.push("responseBody sub-struct is missing");
  } else {
    const rsb = responseBody as Record<string, unknown>;
    for (const field of [
      "minimalBlockTimestamp",
      "firstOverflowBlockNumber",
      "firstOverflowBlockTimestamp",
    ] as const) {
      if (!isUnsignedBigint(rsb[field])) {
        issues.push(`responseBody.${field} must be a non-negative integer`);
      }
    }
  }

  return issues;
}

/** Validate the `merkleProof` array shape (bytes32 entries). */
export function validateMerkleProof(merkleProof: unknown): readonly string[] {
  if (!Array.isArray(merkleProof)) {
    return ["merkleProof must be an array"];
  }
  const issues: string[] = [];
  merkleProof.forEach((entry, index) => {
    if (!isBytes32(entry)) {
      issues.push(`merkleProof[${index}] must be bytes32`);
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// executeDefault argument assembly
// ---------------------------------------------------------------------------

/**
 * Build validated `executeDefault(proof, redemptionRequestId)` arguments from a
 * backend proof record. Returns a typed failure (never throws) listing every
 * problem, so the UI can distinguish "no proof yet" from "proof present but
 * unusable" and never encodes an invalid struct into a wallet transaction.
 */
export function buildExecuteDefaultArgs(
  proof: SerializedFdcProofRecord | null | undefined,
  requestId: string,
): BuildProofResult {
  const issues: string[] = [];

  const parsedRequestId = parseRedemptionRequestId(requestId);
  if (parsedRequestId === null) {
    issues.push("redemptionRequestId must be a non-negative integer");
  }

  if (proof === null || proof === undefined) {
    issues.push("no FDC proof is available yet");
    return { ok: false, issues };
  }

  const merkleIssues = validateMerkleProof(proof.merkleProof);
  issues.push(...merkleIssues);

  const decoded = decodeProofResponseBody(proof.responseBody);
  if (!decoded.ok) {
    issues.push(decoded.issue);
  }

  if (issues.length > 0 || !decoded.ok || parsedRequestId === null) {
    return { ok: false, issues };
  }

  const args: ExecuteDefaultArgs = [
    {
      merkleProof: proof.merkleProof as readonly Hex[],
      data: decoded.data,
    },
    parsedRequestId,
  ];

  return { ok: true, args };
}

// ---------------------------------------------------------------------------
// executeXrpDefault (redeem-by-tag default lane)
// ---------------------------------------------------------------------------

export type XrpExecuteRequestBody = Readonly<{
  minimalBlockNumber: bigint;
  deadlineBlockNumber: bigint;
  deadlineTimestamp: bigint;
  destinationAddressHash: Hex;
  amount: bigint;
  checkFirstMemoData: boolean;
  firstMemoDataHash: Hex;
  checkDestinationTag: boolean;
  destinationTag: bigint;
  proofOwner: Hex;
}>;

export type XrpExecuteResponseData = Readonly<{
  attestationType: Hex;
  sourceId: Hex;
  votingRound: bigint;
  lowestUsedTimestamp: bigint;
  requestBody: XrpExecuteRequestBody;
  responseBody: ExecuteDefaultResponseBody;
}>;

/** The `proof` (first) argument to `HarborRedeemer.executeXrpDefault`. */
export type ExecuteXrpDefaultProofArg = Readonly<{
  merkleProof: readonly Hex[];
  data: XrpExecuteResponseData;
}>;

/** Positional args for `executeXrpDefault(proof, redemptionRequestId)`. */
export type ExecuteXrpDefaultArgs = readonly [
  ExecuteXrpDefaultProofArg,
  bigint,
];

type XrpDecodeResult =
  | Readonly<{ ok: true; data: XrpExecuteResponseData }>
  | Readonly<{ ok: false; issue: string }>;

/** Decode the ABI-encoded XRP `responseBody` hex into structured data. */
export function decodeXrpProofResponseBody(
  responseBody: unknown,
): XrpDecodeResult {
  if (
    typeof responseBody !== "string" ||
    !/^0x[0-9a-fA-F]*$/.test(responseBody)
  ) {
    return { ok: false, issue: "responseBody is not a hex string" };
  }

  let decoded: unknown;
  try {
    decoded = decodeAbiParameters(
      XRP_RESPONSE_TUPLE_ABI,
      responseBody as Hex,
    )[0];
  } catch {
    return {
      ok: false,
      issue: "responseBody is not a valid encoded XRP FDC Response tuple",
    };
  }

  const issues = validateXrpResponseData(decoded);
  if (issues.length > 0) {
    return { ok: false, issue: issues[0] ?? "responseBody is malformed" };
  }

  return { ok: true, data: decoded as XrpExecuteResponseData };
}

/** Validate the decoded XRP Response tuple field-by-field. */
export function validateXrpResponseData(value: unknown): readonly string[] {
  const issues: string[] = [];
  if (typeof value !== "object" || value === null) {
    return ["XRP Response data is not an object"];
  }
  const data = value as Record<string, unknown>;

  if (!isBytes32(data["attestationType"])) {
    issues.push("attestationType must be bytes32");
  }
  if (!isBytes32(data["sourceId"])) {
    issues.push("sourceId must be bytes32");
  }
  if (!isUnsignedBigint(data["votingRound"])) {
    issues.push("votingRound must be a non-negative integer");
  }
  if (!isUnsignedBigint(data["lowestUsedTimestamp"])) {
    issues.push("lowestUsedTimestamp must be a non-negative integer");
  }

  const requestBody = data["requestBody"];
  if (typeof requestBody !== "object" || requestBody === null) {
    issues.push("requestBody is missing");
  } else {
    const rb = requestBody as Record<string, unknown>;
    for (const field of [
      "minimalBlockNumber",
      "deadlineBlockNumber",
      "deadlineTimestamp",
      "amount",
      "destinationTag",
    ] as const) {
      if (!isUnsignedBigint(rb[field])) {
        issues.push(`requestBody.${field} must be a non-negative integer`);
      }
    }
    if (!isBytes32(rb["destinationAddressHash"])) {
      issues.push("requestBody.destinationAddressHash must be bytes32");
    }
    if (!isBytes32(rb["firstMemoDataHash"])) {
      issues.push("requestBody.firstMemoDataHash must be bytes32");
    }
    if (typeof rb["checkFirstMemoData"] !== "boolean") {
      issues.push("requestBody.checkFirstMemoData must be a boolean");
    }
    if (typeof rb["checkDestinationTag"] !== "boolean") {
      issues.push("requestBody.checkDestinationTag must be a boolean");
    }
    if (typeof rb["proofOwner"] !== "string" || !isAddress(rb["proofOwner"])) {
      issues.push("requestBody.proofOwner must be an address");
    }
  }

  const responseBody = data["responseBody"];
  if (typeof responseBody !== "object" || responseBody === null) {
    issues.push("responseBody sub-struct is missing");
  } else {
    const rsb = responseBody as Record<string, unknown>;
    for (const field of [
      "minimalBlockTimestamp",
      "firstOverflowBlockNumber",
      "firstOverflowBlockTimestamp",
    ] as const) {
      if (!isUnsignedBigint(rsb[field])) {
        issues.push(`responseBody.${field} must be a non-negative integer`);
      }
    }
  }

  return issues;
}

/** Build validated `executeXrpDefault(proof, redemptionRequestId)` arguments. */
export function buildExecuteXrpDefaultArgs(
  proof: SerializedFdcProofRecord | null | undefined,
  requestId: string,
): BuildProofResult<ExecuteXrpDefaultArgs> {
  const issues: string[] = [];

  const parsedRequestId = parseRedemptionRequestId(requestId);
  if (parsedRequestId === null) {
    issues.push("redemptionRequestId must be a non-negative integer");
  }

  if (proof === null || proof === undefined) {
    issues.push("no FDC proof is available yet");
    return { ok: false, issues };
  }

  const merkleIssues = validateMerkleProof(proof.merkleProof);
  issues.push(...merkleIssues);

  const decoded = decodeXrpProofResponseBody(proof.responseBody);
  if (!decoded.ok) {
    issues.push(decoded.issue);
  }

  if (issues.length > 0 || !decoded.ok || parsedRequestId === null) {
    return { ok: false, issues };
  }

  const args: ExecuteXrpDefaultArgs = [
    {
      merkleProof: proof.merkleProof as readonly Hex[],
      data: decoded.data,
    },
    parsedRequestId,
  ];

  return { ok: true, args };
}

/**
 * The default-execution target for a redemption, selected by `redemptionKind`.
 * A `WITH_TAG` redemption routes to `executeXrpDefault` (the XRP-native default
 * lane); a `STANDARD` redemption routes to `executeDefault`. Mirrors how the
 * backend keeper picks the entrypoint, so the UI never fabricates calldata.
 */
export type DefaultExecutionTarget =
  | Readonly<{
      ok: true;
      functionName: "executeDefault";
      args: ExecuteDefaultArgs;
    }>
  | Readonly<{
      ok: true;
      functionName: "executeXrpDefault";
      args: ExecuteXrpDefaultArgs;
    }>
  | Readonly<{ ok: false; issues: readonly string[] }>;

export function buildDefaultExecutionArgs(
  proof: SerializedFdcProofRecord | null | undefined,
  requestId: string,
  redemptionKind: RedemptionKind,
): DefaultExecutionTarget {
  if (redemptionKind === "WITH_TAG") {
    const result = buildExecuteXrpDefaultArgs(proof, requestId);
    if (!result.ok) {
      return { ok: false, issues: result.issues };
    }
    return { ok: true, functionName: "executeXrpDefault", args: result.args };
  }

  const result = buildExecuteDefaultArgs(proof, requestId);
  if (!result.ok) {
    return { ok: false, issues: result.issues };
  }
  return { ok: true, functionName: "executeDefault", args: result.args };
}

/**
 * Resolve a usable HarborRedeemer address from the configured contract address,
 * or `null` when it is unset/invalid. The self-recovery target is the same
 * Harbor contract used as the redeem executor (Prompt #04).
 */
export function resolveHarborRedeemerAddress(
  contractAddress: string | null | undefined,
): Hex | null {
  if (
    contractAddress === null ||
    contractAddress === undefined ||
    !isAddress(contractAddress)
  ) {
    return null;
  }
  return getAddress(contractAddress);
}

// ---------------------------------------------------------------------------
// Panel state machine
// ---------------------------------------------------------------------------

/**
 * Discrete self-recovery panel states. Every one maps to a distinct, honest
 * message so the user always knows the exact transaction state.
 */
export type SelfRecoveryPhase =
  | "hidden"
  | "proof-not-ready"
  | "proof-invalid"
  | "contract-unconfigured"
  | "wallet-required"
  | "wrong-network"
  | "ready"
  | "submitting"
  | "submitted"
  | "recovered";

/** Local (in-browser) state of the user's own default transaction. */
export type LocalTxState = "idle" | "submitting" | "submitted";

export type SelfRecoveryPhaseInput = Readonly<{
  /** Whether the panel should be shown at all (on the recovery track). */
  visible: boolean;
  /** Backend confirms the AssetManager paid the default (terminal success). */
  recovered: boolean;
  /** A default transaction already exists (keeper, this user, or a third party). */
  defaultSubmitted: boolean;
  /** A retrievable FDC proof record is present in the response. */
  proofAvailable: boolean;
  /** The available proof decodes/validates into usable calldata. */
  proofValid: boolean;
  /** A HarborRedeemer address is configured. */
  contractConfigured: boolean;
  /** A wallet is connected. */
  walletConnected: boolean;
  /** The connected wallet is on Coston2. */
  correctNetwork: boolean;
  /** The user's own in-flight/confirmed transaction state. */
  localTx: LocalTxState;
}>;

/**
 * Pure state machine for the self-recovery panel. Terminal/observed backend
 * states (`recovered`, an existing default) take precedence over local wallet
 * readiness, which is what makes front-running harmless: if anyone else lands
 * the same default first, the panel simply resolves to "submitted" and then
 * "recovered" on the next refresh instead of surfacing an error.
 *
 * Note: this function takes NO keeper-liveness / health input. Self-recovery
 * availability depends only on the redemption window, the proof, the wallet,
 * and the chain — never on whether the Harbor keeper is healthy.
 */
export function resolveSelfRecoveryPhase(
  input: SelfRecoveryPhaseInput,
): SelfRecoveryPhase {
  if (input.recovered) {
    return "recovered";
  }
  // An existing on-chain default (from anyone) or our confirmed submission.
  if (input.localTx === "submitted" || input.defaultSubmitted) {
    return "submitted";
  }
  if (input.localTx === "submitting") {
    return "submitting";
  }
  if (!input.visible) {
    return "hidden";
  }
  if (!input.proofAvailable) {
    return "proof-not-ready";
  }
  if (!input.proofValid) {
    return "proof-invalid";
  }
  if (!input.contractConfigured) {
    return "contract-unconfigured";
  }
  if (!input.walletConnected) {
    return "wallet-required";
  }
  if (!input.correctNetwork) {
    return "wrong-network";
  }
  return "ready";
}
