import {
  referencedPaymentNonexistenceResponseAbi,
  xrpPaymentNonexistenceResponseAbi,
} from "@harbor/protocol";
import {
  emptyAgentDetails,
  type AgentDetails,
  type FdcRequestStatus,
  type GetRedemptionResponse,
  type RedemptionKind,
  type RedemptionStatus,
  type RedemptionTimelineEntry,
  type SerializedFdcProofRecord,
  type SerializedFdcRequestRecord,
  type SerializedRedemptionDetail,
  type SerializedXrplPaymentObservation,
} from "@harbor/shared";
import { encodeAbiParameters } from "viem";

/**
 * Builders for the serialized `GET /redemptions/:id` payload used across the
 * status view's unit, component, and E2E-style tests. The `statusTimeline` is
 * synthesized with the same evidence-based rules the backend uses (Prompt #15
 * `buildRedemptionTimeline`) so the frontend is exercised against realistic
 * input rather than hand-authored timelines.
 */

const BASE_TIME = Date.parse("2026-02-01T00:00:00.000Z");
const MINUTE = 60_000;

/** ISO timestamp `minutes` after the fixture base time. */
export function fixtureTime(minutes: number): string {
  return new Date(BASE_TIME + minutes * MINUTE).toISOString();
}

const DEFAULT_AGENT_VAULT = "0x00000000000000000000000000000000000000a1";
const DEFAULT_REDEEMER = "0x00000000000000000000000000000000000000b2";
const DEFAULT_ASSET_MANAGER = "0xc1ca88b937d0b528842f95d5731ffb586f4fbdfa";
const DEFAULT_PAYMENT_REFERENCE =
  "0x4642505266410001000000000000000000000000000000000000000000000001";
const DEFAULT_XRPL_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const DEFAULT_TX_HASH: `0x${string}` = `0x${"de".repeat(32)}`;

/** Deterministic 0x-prefixed 32-byte hash (the shared type brands these). */
function hashFromSeed(seed: string): `0x${string}` {
  const hex = [...seed]
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0")
    .slice(0, 64);
  return `0x${hex}`;
}

export type RedemptionScenarioOptions = Readonly<{
  requestId?: string;
  status?: RedemptionStatus;
  statusReason?: string | null;
  withSettlement?: boolean;
  settlementCount?: number;
  fdcRequestStatus?: FdcRequestStatus | null;
  withProof?: boolean;
  /**
   * When `true`, the FDC proof's `responseBody` is a real ABI-encoded Response
   * tuple (decodable into `executeDefault` calldata) instead of the inert
   * `0xfeed` placeholder. Used by the self-recovery panel and E2E tests.
   */
  validProof?: boolean;
  withDefaultTransaction?: boolean;
  timeline?: readonly RedemptionTimelineEntry[];
  generatedAt?: string;
  /**
   * Official details for the assigned agent. Defaults to `emptyAgentDetails`
   * (all `null`) so the status view falls back to the vault address unless a
   * test opts into official metadata.
   */
  agentDetails?: AgentDetails;
  /**
   * Redemption lane. Defaults to `STANDARD`. Set to `WITH_TAG` (together with a
   * `destinationTag`) to exercise the redeem-by-tag status view.
   */
  redemptionKind?: RedemptionKind;
  /**
   * Required destination tag on the redemption detail (serialized as a decimal
   * string), or `null`. Defaults to `null` (standard lane).
   */
  destinationTag?: `${bigint}` | null;
  /**
   * Destination tag stamped on the synthesized XRPL settlement receipt(s), or
   * `null`. Defaults to `null` so standard receipts render no tag row.
   */
  receiptDestinationTag?: `${bigint}` | null;
}>;

function makeReceipt(
  requestId: string,
  index: number,
  destinationTag: `${bigint}` | null = null,
): SerializedXrplPaymentObservation {
  return {
    observationId: `obs-${requestId}-${index}`,
    redemptionRequestId: requestId,
    transactionHash: hashFromSeed(`xrpl-${requestId}-${index}`),
    sourceAddress: "rAgentSourceAddr000000000000000000",
    destinationAddress: DEFAULT_XRPL_ADDRESS,
    deliveredAmountUBA: "10000000",
    feeDrops: "12",
    paymentReference: DEFAULT_PAYMENT_REFERENCE,
    ledgerIndex: "48213377",
    closeTimestamp: fixtureTime(6),
    validatedAt: fixtureTime(6),
    destinationTag,
    createdAt: fixtureTime(6),
  };
}

function makeFdcRequest(
  requestId: string,
  status: FdcRequestStatus,
): SerializedFdcRequestRecord {
  return {
    fdcRequestId: `fdc-req-${requestId}`,
    redemptionRequestId: requestId,
    attestationType: `0x${"11".repeat(32)}`,
    sourceId: `0x${"22".repeat(32)}`,
    requestBody: "0xabcdef",
    requestHash: `0x${"33".repeat(32)}`,
    status,
    votingRoundId: "12345",
    createdAt: fixtureTime(20),
    updatedAt: fixtureTime(22),
  };
}

/** viem descriptor for the encoded `IReferencedPaymentNonexistence.Response`. */
const RESPONSE_TUPLE_ABI = [
  { type: "tuple", components: referencedPaymentNonexistenceResponseAbi },
] as const;

/**
 * A structurally valid decoded FDC `Response`, matching the shape the backend
 * keeper assembles for `executeDefault`. The exact field values are arbitrary
 * (no live chain verifies them in tests); only the ABI shape matters.
 */
export function sampleProofResponseData() {
  return {
    attestationType: `0x${"11".repeat(32)}`,
    sourceId: `0x${"22".repeat(32)}`,
    votingRound: 12345n,
    lowestUsedTimestamp: 1700000000n,
    requestBody: {
      minimalBlockNumber: 100n,
      deadlineBlockNumber: 200n,
      deadlineTimestamp: 1700000500n,
      destinationAddressHash: `0x${"33".repeat(32)}`,
      amount: 10000000n,
      standardPaymentReference: DEFAULT_PAYMENT_REFERENCE,
      checkSourceAddresses: false,
      sourceAddressesRoot: `0x${"00".repeat(32)}`,
    },
    responseBody: {
      minimalBlockTimestamp: 1699999000n,
      firstOverflowBlockNumber: 250n,
      firstOverflowBlockTimestamp: 1700000600n,
    },
  } as const;
}

/**
 * ABI-encoded Response tuple, mirroring what the backend persists and exposes
 * as an FDC proof's `responseBody` (see `fdc/daLayer.ts`).
 */
export function encodeSampleProofResponseBody(): `0x${string}` {
  // The protocol ABI is typed with its own loose `AbiParameter`, so viem cannot
  // infer the named-object value shape and over-narrows the value type. The
  // object form is correct at runtime (verified by round-trip decode); cast the
  // value to satisfy the compiler. This mirrors how production code casts these
  // ABIs for the wagmi/viem hooks.
  return encodeAbiParameters(RESPONSE_TUPLE_ABI, [
    sampleProofResponseData(),
  ] as never) as `0x${string}`;
}

/** viem descriptor for the encoded `IXRPPaymentNonexistence.Response`. */
const XRP_RESPONSE_TUPLE_ABI = [
  { type: "tuple", components: xrpPaymentNonexistenceResponseAbi },
] as const;

/** A structurally valid decoded XRP `Response` for `executeXrpDefault`. */
export function sampleXrpProofResponseData() {
  return {
    attestationType: `0x${"09".repeat(32)}`,
    sourceId: `0x${"22".repeat(32)}`,
    votingRound: 12345n,
    lowestUsedTimestamp: 1700000000n,
    requestBody: {
      minimalBlockNumber: 100n,
      deadlineBlockNumber: 200n,
      deadlineTimestamp: 1700000500n,
      destinationAddressHash: `0x${"33".repeat(32)}`,
      amount: 9990000n,
      checkFirstMemoData: true,
      firstMemoDataHash: DEFAULT_PAYMENT_REFERENCE,
      checkDestinationTag: true,
      destinationTag: 12345n,
      proofOwner: `0x${"00".repeat(20)}`,
    },
    responseBody: {
      minimalBlockTimestamp: 1699999000n,
      firstOverflowBlockNumber: 250n,
      firstOverflowBlockTimestamp: 1700000600n,
    },
  } as const;
}

/** ABI-encoded XRP `Response` tuple for the redeem-by-tag default proof. */
export function encodeSampleXrpProofResponseBody(): `0x${string}` {
  return encodeAbiParameters(XRP_RESPONSE_TUPLE_ABI, [
    sampleXrpProofResponseData(),
  ] as never) as `0x${string}`;
}

function makeFdcProof(
  requestId: string,
  valid: boolean,
): SerializedFdcProofRecord {
  return {
    fdcProofId: `fdc-proof-${requestId}`,
    fdcRequestId: `fdc-req-${requestId}`,
    redemptionRequestId: requestId,
    requestHash: `0x${"33".repeat(32)}`,
    responseBody: valid ? encodeSampleProofResponseBody() : "0xfeed",
    merkleProof: [`0x${"44".repeat(32)}`, `0x${"55".repeat(32)}`],
    votingRoundId: "12345",
    createdAt: fixtureTime(30),
  };
}

/** An XRP-shaped proof record for redeem-by-tag self-recovery tests. */
export function makeXrpFdcProof(
  requestId: string,
  valid: boolean = true,
): SerializedFdcProofRecord {
  return {
    ...makeFdcProof(requestId, valid),
    fdcProofId: `xrp-fdc-proof-${requestId}`,
    responseBody: valid ? encodeSampleXrpProofResponseBody() : "0xfeed",
  };
}

/**
 * Reproduce the backend's evidence-based timeline: a REQUESTED milestone, one
 * SETTLED per XRPL observation, one REQUEST_PROOF per FDC request, one
 * PROOF_READY per proof, a DEFAULT_SUBMITTED when a default tx exists, and the
 * current status as the final milestone when it was not already emitted.
 */
function synthesizeTimeline(
  detail: SerializedRedemptionDetail,
  receipts: readonly SerializedXrplPaymentObservation[],
  fdcRequests: readonly SerializedFdcRequestRecord[],
  fdcProofs: readonly SerializedFdcProofRecord[],
): readonly RedemptionTimelineEntry[] {
  const entries: RedemptionTimelineEntry[] = [];
  const seen = new Set<RedemptionStatus>();
  const add = (
    status: RedemptionStatus,
    occurredAt: string,
    source: RedemptionTimelineEntry["source"],
    detailText: string | null,
  ): void => {
    entries.push({ status, occurredAt, source, detail: detailText });
    seen.add(status);
  };

  add(
    "REQUESTED",
    detail.createdAt,
    "REDEMPTION",
    "Redemption request recorded",
  );
  for (const receipt of receipts) {
    add(
      "SETTLED",
      receipt.validatedAt,
      "XRPL_OBSERVATION",
      `XRPL payment ${receipt.transactionHash}`,
    );
  }
  for (const request of fdcRequests) {
    add(
      "REQUEST_PROOF",
      request.createdAt,
      "FDC_REQUEST",
      `FDC request ${request.status}`,
    );
  }
  for (const proof of fdcProofs) {
    add(
      "PROOF_READY",
      proof.createdAt,
      "FDC_PROOF",
      `FDC round ${proof.votingRoundId}`,
    );
  }
  if (detail.defaultTransactionHash !== null) {
    add(
      "DEFAULT_SUBMITTED",
      detail.updatedAt,
      "KEEPER",
      `Default transaction ${detail.defaultTransactionHash}`,
    );
  }
  if (!seen.has(detail.status)) {
    add(detail.status, detail.updatedAt, "REDEMPTION", detail.statusReason);
  }

  return [...entries].sort((left, right) =>
    left.occurredAt < right.occurredAt
      ? -1
      : left.occurredAt > right.occurredAt
        ? 1
        : 0,
  );
}

/** Build a full serialized redemption response for the given scenario. */
export function makeRedemptionResponse(
  options: RedemptionScenarioOptions = {},
): GetRedemptionResponse {
  const requestId = options.requestId ?? "4207";
  const status = options.status ?? "REQUESTED";
  const withDefaultTransaction = options.withDefaultTransaction ?? false;

  const settlementCount = options.withSettlement
    ? Math.max(1, options.settlementCount ?? 1)
    : 0;
  const receipts: SerializedXrplPaymentObservation[] = Array.from(
    { length: settlementCount },
    (_unused, index) =>
      makeReceipt(requestId, index, options.receiptDestinationTag ?? null),
  );

  const fdcRequests: SerializedFdcRequestRecord[] =
    options.fdcRequestStatus === null || options.fdcRequestStatus === undefined
      ? []
      : [makeFdcRequest(requestId, options.fdcRequestStatus)];

  const fdcProofs: SerializedFdcProofRecord[] = options.withProof
    ? [makeFdcProof(requestId, options.validProof ?? false)]
    : [];

  const detail: SerializedRedemptionDetail = {
    requestId,
    assetManagerAddress: DEFAULT_ASSET_MANAGER,
    status,
    statusReason: options.statusReason ?? null,
    redeemer: DEFAULT_REDEEMER,
    agentVault: DEFAULT_AGENT_VAULT,
    agentDetails: options.agentDetails ?? emptyAgentDetails,
    paymentAddress: DEFAULT_XRPL_ADDRESS,
    redemptionKind: options.redemptionKind ?? "STANDARD",
    destinationTag: options.destinationTag ?? null,
    valueUBA: "10000000",
    feeUBA: "0",
    paymentReference: DEFAULT_PAYMENT_REFERENCE,
    transactionHash: `0x${"ab".repeat(32)}`,
    defaultTransactionHash: withDefaultTransaction ? DEFAULT_TX_HASH : null,
    executor: "0x0000000000000000000000000000000000000000",
    executorFeeNatWei: "0",
    firstUnderlyingBlock: "100",
    lastUnderlyingBlock: "200",
    lastUnderlyingTimestamp: "1700000000",
    createdAt: fixtureTime(0),
    updatedAt: fixtureTime(40),
  };

  return {
    redemption: detail,
    statusTimeline:
      options.timeline ??
      synthesizeTimeline(detail, receipts, fdcRequests, fdcProofs),
    xrplReceipts: receipts,
    fdcRequests,
    fdcProofs,
    defaultTransactionHash: detail.defaultTransactionHash,
    generatedAt: options.generatedAt ?? fixtureTime(41),
  };
}

/** A settled (happy-path) redemption with a single XRPL receipt. */
export function settledResponse(
  overrides: RedemptionScenarioOptions = {},
): GetRedemptionResponse {
  return makeRedemptionResponse({
    status: "SETTLED",
    withSettlement: true,
    ...overrides,
  });
}

/** A redemption whose window was missed and whose proof is now ready. */
export function proofReadyResponse(
  overrides: RedemptionScenarioOptions = {},
): GetRedemptionResponse {
  return makeRedemptionResponse({
    status: "PROOF_READY",
    fdcRequestStatus: "PROOF_READY",
    withProof: true,
    ...overrides,
  });
}

/** A redemption with a submitted (but not yet recovered) default. */
export function defaultSubmittedResponse(
  overrides: RedemptionScenarioOptions = {},
): GetRedemptionResponse {
  return makeRedemptionResponse({
    status: "DEFAULT_SUBMITTED",
    fdcRequestStatus: "PROOF_READY",
    withProof: true,
    withDefaultTransaction: true,
    ...overrides,
  });
}

/** A fully recovered default. */
export function recoveredResponse(
  overrides: RedemptionScenarioOptions = {},
): GetRedemptionResponse {
  return makeRedemptionResponse({
    status: "RECOVERED",
    fdcRequestStatus: "PROOF_READY",
    withProof: true,
    withDefaultTransaction: true,
    ...overrides,
  });
}
