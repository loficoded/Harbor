import {
  emptyAgentDetails,
  type AgentDetails,
  type FdcRequestStatus,
  type GetRedemptionResponse,
  type RedemptionStatus,
  type SerializedFdcProofRecord,
  type SerializedFdcRequestRecord,
  type SerializedXrplPaymentObservation,
} from "@harbor/shared";

import { formatFxrpAmount, FXRP_LABEL } from "@/lib/redemption";
import {
  redemptionStatusLabel,
  redemptionStatusTone,
  type StatusTone,
} from "@/lib/status";

/**
 * Pure view-model derivation for the `/status/[id]` route. Everything here maps
 * the backend redemption response (`GET /redemptions/:id`, Prompt #15) onto the
 * exact things the UI renders, with no React, fetching, or polling. Keeping it
 * pure makes every timeline branch, receipt field, and honest-copy gate
 * directly unit testable, and lets the container (Prompt #18) and the future
 * self-recovery flow (Prompt #20) share one source of truth.
 *
 * The backend derives its `statusTimeline` from concrete evidence (the request
 * row, XRPL observations, FDC requests/proofs, a submitted default) rather than
 * from an inferred state path, so soft states like `WATCHING` and
 * `WINDOW_EXPIRED` only appear when they are the *current* status. This module
 * reconciles that sparse evidence with the redemption's current status to
 * present a complete, honest lifecycle.
 */

// ---------------------------------------------------------------------------
// Timeline model
// ---------------------------------------------------------------------------

/**
 * Display state for a single timeline milestone.
 * - `complete`: recorded (or a guaranteed predecessor of a recorded state).
 * - `current`: the redemption's present, non-terminal status.
 * - `upcoming`: a step that may still occur on the current trajectory.
 * - `skipped`: not recorded on this redemption's path (branch not taken, or a
 *   soft state that left no evidence). Rendered muted and never as progress.
 * - `attention`: a terminal failure / unknown state needing manual attention.
 */
export type TimelineStepState =
  "complete" | "current" | "upcoming" | "skipped" | "attention";

export type TimelineStep = Readonly<{
  status: RedemptionStatus;
  label: string;
  description: string;
  state: TimelineStepState;
  /** Evidence timestamp (ISO) when the milestone was recorded, else `null`. */
  occurredAt: string | null;
  /** Evidence detail string from the backend timeline, when present. */
  detail: string | null;
}>;

/**
 * Canonical lifecycle order for the happy-settlement and default-recovery
 * paths. `SETTLED` and the recovery states are mutually exclusive branches;
 * both are shown so the timeline reads as a complete lifecycle.
 */
export const CANONICAL_STATUS_ORDER: readonly RedemptionStatus[] = [
  "REQUESTED",
  "WATCHING",
  "SETTLED",
  "WINDOW_EXPIRED",
  "REQUEST_PROOF",
  "PROOF_READY",
  "DEFAULT_SUBMITTED",
  "RECOVERED",
];

/** Timeline milestone copy. Intentionally more descriptive than badge labels. */
const TIMELINE_STEP_LABELS: Record<RedemptionStatus, string> = {
  REQUESTED: "Redemption requested",
  WATCHING: "Agent payment window active",
  SETTLED: "Settled on XRPL",
  WINDOW_EXPIRED: "Payment window missed",
  REQUEST_PROOF: "FDC non-payment proof requested",
  PROOF_READY: "Proof ready",
  DEFAULT_SUBMITTED: "Default submitted",
  RECOVERED: "Recovered",
  FAILED: "Failed — manual attention",
  UNKNOWN: "Status unknown — manual attention",
};

const TIMELINE_STEP_DESCRIPTIONS: Record<RedemptionStatus, string> = {
  REQUESTED: "The on-chain redemption request was recorded.",
  WATCHING: "The agent has an on-time window to pay the XRPL destination.",
  SETTLED: "Harbor observed the agent's XRPL payment for this request.",
  WINDOW_EXPIRED: "The agent did not pay within the allowed window.",
  REQUEST_PROOF:
    "A Flare Data Connector non-payment attestation was requested.",
  PROOF_READY: "The FDC proof is retrievable and ready to submit.",
  DEFAULT_SUBMITTED:
    "A default was submitted to the AssetManager using the FDC proof.",
  RECOVERED: "The AssetManager paid out the redemption default.",
  FAILED: "The redemption could not complete automatically.",
  UNKNOWN: "The backend cannot classify this redemption's state.",
};

/** Recovery-track states (the branch taken when the agent does not pay). */
const RECOVERY_STATUSES: ReadonlySet<RedemptionStatus> = new Set([
  "WINDOW_EXPIRED",
  "REQUEST_PROOF",
  "PROOF_READY",
  "DEFAULT_SUBMITTED",
  "RECOVERED",
]);

/** Position within the recovery track, used to order past vs. future steps. */
const RECOVERY_RANK: Partial<Record<RedemptionStatus, number>> = {
  WINDOW_EXPIRED: 0,
  REQUEST_PROOF: 1,
  PROOF_READY: 2,
  DEFAULT_SUBMITTED: 3,
  RECOVERED: 4,
};

/**
 * Guaranteed predecessors implied by the FAssets redemption state machine
 * (Prompt #02 `redemptionStatusTransitions`). Only transitions with a single
 * possible source are encoded, so a step is marked complete-by-implication only
 * when it *must* have happened — never on a guess. For example `SETTLED` is
 * reachable only from `WATCHING`, so reaching `SETTLED` proves `WATCHING`; but
 * `REQUEST_PROOF` is reachable without `WINDOW_EXPIRED`, so that is not implied.
 */
const MANDATORY_PREDECESSORS: Record<
  RedemptionStatus,
  readonly RedemptionStatus[]
> = {
  REQUESTED: [],
  WATCHING: ["REQUESTED"],
  SETTLED: ["REQUESTED", "WATCHING"],
  WINDOW_EXPIRED: ["REQUESTED"],
  REQUEST_PROOF: ["REQUESTED"],
  PROOF_READY: ["REQUESTED", "REQUEST_PROOF"],
  DEFAULT_SUBMITTED: ["REQUESTED", "REQUEST_PROOF", "PROOF_READY"],
  RECOVERED: ["REQUESTED", "REQUEST_PROOF", "PROOF_READY"],
  FAILED: [],
  UNKNOWN: [],
};

// Mirrors `@harbor/shared`'s `terminalRedemptionStatuses`. Defined locally
// rather than imported so this browser module does not pull the shared
// package's Node-only env entry (which imports `node:url`) into the client
// bundle via the shared barrel export.
const TERMINAL_STATUSES: ReadonlySet<RedemptionStatus> = new Set([
  "SETTLED",
  "RECOVERED",
  "FAILED",
]);

const TERMINAL_SUCCESS_STATUSES: ReadonlySet<RedemptionStatus> = new Set([
  "SETTLED",
  "RECOVERED",
]);

/** Whether the redemption has reached a terminal status (polling can stop). */
export function isTerminalStatus(status: RedemptionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Whether the status is a terminal *success* (settled or recovered). */
export function isTerminalSuccess(status: RedemptionStatus): boolean {
  return TERMINAL_SUCCESS_STATUSES.has(status);
}

/** Whether the status needs manual attention (failed / unknown). */
export function needsAttention(status: RedemptionStatus): boolean {
  return status === "FAILED" || status === "UNKNOWN";
}

/**
 * Reconcile the backend's evidence-based timeline with the current status to
 * produce the full, ordered lifecycle shown in the UI. Returns one step per
 * canonical status, plus a trailing attention step when the redemption failed
 * or is unclassified.
 */
export function deriveStatusTimeline(
  response: GetRedemptionResponse,
): readonly TimelineStep[] {
  const current = response.redemption.status;
  const attention = needsAttention(current);

  const firstEntryByStatus = new Map<
    RedemptionStatus,
    GetRedemptionResponse["statusTimeline"][number]
  >();
  for (const entry of response.statusTimeline) {
    if (!firstEntryByStatus.has(entry.status)) {
      firstEntryByStatus.set(entry.status, entry);
    }
  }

  const reached = new Set<RedemptionStatus>(firstEntryByStatus.keys());

  // A step is complete if it has evidence, or is a guaranteed predecessor of
  // any reached status or of the current status.
  const complete = new Set<RedemptionStatus>(reached);
  const anchors = new Set<RedemptionStatus>(reached);
  anchors.add(current);
  for (const anchor of anchors) {
    for (const predecessor of MANDATORY_PREDECESSORS[anchor]) {
      complete.add(predecessor);
    }
  }

  const settlementResolved = complete.has("SETTLED") || current === "SETTLED";
  const currentRecoveryRank = RECOVERY_RANK[current];
  const recoveryEngaged =
    current !== "SETTLED" &&
    (currentRecoveryRank !== undefined ||
      [...RECOVERY_STATUSES].some((status) => reached.has(status)));

  const steps: TimelineStep[] = CANONICAL_STATUS_ORDER.map((status) => {
    const entry = firstEntryByStatus.get(status);
    const occurredAt = entry?.occurredAt ?? null;
    const detail = entry?.detail ?? null;
    const state = resolveStepState(status, {
      current,
      attention,
      complete,
      settlementResolved,
      recoveryEngaged,
      currentRecoveryRank,
    });

    return {
      status,
      label: TIMELINE_STEP_LABELS[status],
      description: TIMELINE_STEP_DESCRIPTIONS[status],
      state,
      occurredAt,
      detail,
    };
  });

  if (attention) {
    const entry = firstEntryByStatus.get(current);
    steps.push({
      status: current,
      label: TIMELINE_STEP_LABELS[current],
      description: TIMELINE_STEP_DESCRIPTIONS[current],
      state: "attention",
      occurredAt: entry?.occurredAt ?? response.redemption.updatedAt,
      detail: entry?.detail ?? response.redemption.statusReason,
    });
  }

  return steps;
}

type StepContext = Readonly<{
  current: RedemptionStatus;
  attention: boolean;
  complete: ReadonlySet<RedemptionStatus>;
  settlementResolved: boolean;
  recoveryEngaged: boolean;
  currentRecoveryRank: number | undefined;
}>;

/** Classify one canonical step given the reconciled redemption context. */
function resolveStepState(
  status: RedemptionStatus,
  context: StepContext,
): TimelineStepState {
  if (status === context.current) {
    return isTerminalSuccess(status) ? "complete" : "current";
  }

  if (context.complete.has(status)) {
    return "complete";
  }

  // Past a failure/unknown outcome, nothing else is claimed to have happened.
  if (context.attention) {
    return "skipped";
  }

  if (status === "SETTLED") {
    return context.recoveryEngaged ? "skipped" : "upcoming";
  }

  if (RECOVERY_STATUSES.has(status)) {
    if (context.settlementResolved) {
      return "skipped";
    }
    if (context.recoveryEngaged && context.currentRecoveryRank !== undefined) {
      const rank = RECOVERY_RANK[status] ?? 0;
      // Earlier recovery milestones with no evidence were bypassed/unrecorded;
      // later ones are still ahead on the recovery path.
      return rank < context.currentRecoveryRank ? "skipped" : "upcoming";
    }
    // Pre-branch (still REQUESTED/WATCHING): recovery is a contingent future.
    return "upcoming";
  }

  // WATCHING lies in the future only while still at REQUESTED; otherwise the
  // window has already closed and left no recorded evidence.
  if (status === "WATCHING") {
    return context.current === "REQUESTED" ? "upcoming" : "skipped";
  }

  return "upcoming";
}

// ---------------------------------------------------------------------------
// Settlement receipt
// ---------------------------------------------------------------------------

export type SettlementReceipt = Readonly<{
  transactionHash: string;
  deliveredAmountUBA: string;
  deliveredAmountLabel: string;
  feeDrops: string;
  ledgerIndex: string;
  closeTimestamp: string;
  validatedAt: string;
  destinationAddress: string;
  paymentReference: string;
  agentVault: string;
  /** Number of XRPL observations recorded for this request (usually one). */
  observationCount: number;
}>;

/**
 * Project the primary XRPL settlement observation onto the receipt fields the
 * UI shows. The XRPL amount is reported in UBA (the FAsset base unit, equal to
 * XRP drops), so it is formatted with the FXRP decimals for a human label while
 * the raw value is preserved. Returns `null` when no settlement was observed.
 */
export function deriveSettlementReceipt(
  response: GetRedemptionResponse,
): SettlementReceipt | null {
  const receipts: readonly SerializedXrplPaymentObservation[] =
    response.xrplReceipts;
  const primary = receipts[0];

  if (primary === undefined) {
    return null;
  }

  return {
    transactionHash: primary.transactionHash,
    deliveredAmountUBA: primary.deliveredAmountUBA,
    deliveredAmountLabel: formatUbaAmount(primary.deliveredAmountUBA),
    feeDrops: primary.feeDrops,
    ledgerIndex: primary.ledgerIndex,
    closeTimestamp: primary.closeTimestamp,
    validatedAt: primary.validatedAt,
    destinationAddress: primary.destinationAddress,
    paymentReference: primary.paymentReference,
    agentVault: response.redemption.agentVault,
    observationCount: receipts.length,
  };
}

/** Format a UBA base-unit string as an `<amount> FXRP` label, safely. */
export function formatUbaAmount(uba: string): string {
  try {
    return `${formatFxrpAmount(BigInt(uba))} ${FXRP_LABEL}`;
  } catch {
    // A malformed amount should degrade, not crash the status view.
    return `${uba} UBA`;
  }
}

// ---------------------------------------------------------------------------
// Default recovery
// ---------------------------------------------------------------------------

export type DefaultRecoveryInfo = Readonly<{
  /** Latest FDC request status, or `null` when none has been created yet. */
  fdcRequestStatus: FdcRequestStatus | null;
  fdcRequestCount: number;
  /** Whether a retrievable FDC proof exists. */
  proofReady: boolean;
  proofCount: number;
  /** FDC voting round for the proof/request, when known. */
  votingRoundId: string | null;
  /** On-chain default transaction hash (Coston2), when submitted. */
  defaultTransactionHash: string | null;
  /** Whether the AssetManager has paid out the default. */
  recovered: boolean;
}>;

/**
 * Summarize default-recovery progress from the FDC request/proof records and
 * the submitted default transaction. Returns `null` when the redemption has no
 * recovery activity (still settling on the happy path), so the UI can omit the
 * section entirely rather than show an empty shell.
 */
export function deriveDefaultRecovery(
  response: GetRedemptionResponse,
): DefaultRecoveryInfo | null {
  const requests: readonly SerializedFdcRequestRecord[] = response.fdcRequests;
  const proofs: readonly SerializedFdcProofRecord[] = response.fdcProofs;
  const status = response.redemption.status;
  const defaultTransactionHash =
    response.defaultTransactionHash ??
    response.redemption.defaultTransactionHash ??
    null;

  const hasRecoveryActivity =
    RECOVERY_STATUSES.has(status) ||
    requests.length > 0 ||
    proofs.length > 0 ||
    defaultTransactionHash !== null;

  if (!hasRecoveryActivity) {
    return null;
  }

  const latestRequest = requests[requests.length - 1] ?? null;
  const proofReady =
    proofs.length > 0 || latestRequest?.status === "PROOF_READY";

  return {
    fdcRequestStatus: latestRequest?.status ?? null,
    fdcRequestCount: requests.length,
    proofReady,
    proofCount: proofs.length,
    votingRoundId:
      proofs[0]?.votingRoundId ?? latestRequest?.votingRoundId ?? null,
    defaultTransactionHash,
    recovered: status === "RECOVERED",
  };
}

// ---------------------------------------------------------------------------
// Self-recovery (Prompt #20 — permissionless default execution)
// ---------------------------------------------------------------------------

/**
 * Pure model backing the permissionless self-recovery panel. It captures
 * everything the panel needs to decide its state — whether the window has
 * passed, whether a submittable FDC proof exists, whether a default is already
 * on-chain, and whether the AssetManager has recovered — without any wallet or
 * keeper-health input. `visible` intentionally excludes SETTLED and RECOVERED
 * so a freshly-loaded terminal redemption shows no actionable control; the
 * container keeps the panel mounted across an in-session RECOVERED transition
 * so the user sees the recovered confirmation after submitting.
 */
export type SelfRecoveryInfo = Readonly<{
  /** Whether the actionable self-recovery panel should be shown. */
  visible: boolean;
  /** Redemption status this model was derived from. */
  status: RedemptionStatus;
  /** True once the redemption window has passed (recovery track engaged). */
  windowPassed: boolean;
  /** Whether a retrievable FDC proof record is available to submit. */
  proofAvailable: boolean;
  /** The proof record chosen for submission (latest), or `null`. */
  proof: SerializedFdcProofRecord | null;
  /** Latest FDC request status, when known. */
  fdcRequestStatus: FdcRequestStatus | null;
  /** FDC voting round behind the proof/request, when known. */
  votingRoundId: string | null;
  /** A default transaction already exists (keeper, this user, or a third party). */
  defaultSubmitted: boolean;
  /** On-chain default transaction hash, when submitted. */
  defaultTransactionHash: string | null;
  /** The AssetManager has paid out the default (terminal success). */
  recovered: boolean;
}>;

/**
 * Derive the self-recovery model from a redemption response. Availability is a
 * function of the redemption window and the FDC proof only — deliberately not
 * of keeper liveness — so self-recovery stays usable even when the Harbor
 * keeper is unavailable, which is the whole point of this permissionless path.
 */
export function deriveSelfRecovery(
  response: GetRedemptionResponse,
): SelfRecoveryInfo {
  const status = response.redemption.status;

  // The window has passed once the redemption leaves the pre-default lifecycle.
  const windowPassed =
    status === "WINDOW_EXPIRED" ||
    status === "REQUEST_PROOF" ||
    status === "PROOF_READY" ||
    status === "DEFAULT_SUBMITTED" ||
    status === "RECOVERED";

  const proofs = response.fdcProofs;
  const proof = proofs[proofs.length - 1] ?? null;
  const requests = response.fdcRequests;
  const latestRequest = requests[requests.length - 1] ?? null;

  const defaultTransactionHash =
    response.defaultTransactionHash ??
    response.redemption.defaultTransactionHash ??
    null;

  const recovered = status === "RECOVERED";
  const defaultSubmitted =
    status === "DEFAULT_SUBMITTED" || defaultTransactionHash !== null;

  // Shown while on the recovery track and not yet settled/recovered.
  const visible =
    status === "WINDOW_EXPIRED" ||
    status === "REQUEST_PROOF" ||
    status === "PROOF_READY" ||
    status === "DEFAULT_SUBMITTED";

  return {
    visible,
    status,
    windowPassed,
    proofAvailable: proof !== null,
    proof,
    fdcRequestStatus: latestRequest?.status ?? null,
    votingRoundId: proof?.votingRoundId ?? latestRequest?.votingRoundId ?? null,
    defaultSubmitted,
    defaultTransactionHash,
    recovered,
  };
}

// ---------------------------------------------------------------------------
// Related requests
// ---------------------------------------------------------------------------

export type RelatedRequest = Readonly<{
  requestId: string;
  /** True for the id currently being viewed. */
  isCurrent: boolean;
}>;

/**
 * Build the compact related-requests list. A single frontend `redeem` can be
 * filled from multiple agents' tickets, emitting several request ids; the
 * redemption flow (Prompt #17) preserves the extras in the `more` query param.
 * The current id is always first and marked; additional ids are de-duplicated
 * and blanks dropped. Returns a single-entry list when there are no siblings.
 */
export function buildRelatedRequests(
  currentId: string,
  additionalIds: readonly string[],
): readonly RelatedRequest[] {
  const seen = new Set<string>([currentId]);
  const related: RelatedRequest[] = [{ requestId: currentId, isCurrent: true }];

  for (const rawId of additionalIds) {
    const id = rawId.trim();
    if (id === "" || seen.has(id)) {
      continue;
    }
    seen.add(id);
    related.push({ requestId: id, isCurrent: false });
  }

  return related;
}

/** Parse the comma-separated `more` query param into distinct request ids. */
export function parseAdditionalRequestIds(
  moreParam: string | undefined,
): readonly string[] {
  if (moreParam === undefined) {
    return [];
  }

  return moreParam
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

// ---------------------------------------------------------------------------
// Combined view model
// ---------------------------------------------------------------------------

export type RedemptionStatusViewModel = Readonly<{
  status: RedemptionStatus;
  statusLabel: string;
  statusTone: StatusTone;
  statusReason: string | null;
  isTerminal: boolean;
  isTerminalSuccess: boolean;
  needsAttention: boolean;
  timeline: readonly TimelineStep[];
  settlement: SettlementReceipt | null;
  recovery: DefaultRecoveryInfo | null;
  selfRecovery: SelfRecoveryInfo;
  agentVault: string;
  /**
   * Official details of the protocol-assigned agent (name/icon/etc.), from the
   * `AgentOwnerRegistry`. Always present; individual fields are `null` when
   * unavailable so the assigned-agent card falls back to the vault address.
   */
  agentDetails: AgentDetails;
  redeemer: string;
  paymentReference: string;
  generatedAt: string;
}>;

/**
 * Minimal structural guard for a redemption response. This is a defensive check
 * for an unexpected/malformed payload (so the view can show an honest API-error
 * state instead of crashing), not full schema validation — the wire types are
 * owned by `@harbor/shared`.
 */
export function isRedemptionResponse(
  value: unknown,
): value is GetRedemptionResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const redemption = (value as { redemption?: unknown }).redemption;
  if (typeof redemption !== "object" || redemption === null) {
    return false;
  }
  const status = (redemption as { status?: unknown }).status;
  return typeof status === "string";
}

/** Compose the full status view model from a redemption response. */
export function deriveRedemptionStatusViewModel(
  response: GetRedemptionResponse,
): RedemptionStatusViewModel {
  const status = response.redemption.status;

  return {
    status,
    statusLabel: redemptionStatusLabel(status),
    statusTone: redemptionStatusTone(status),
    statusReason: response.redemption.statusReason,
    isTerminal: isTerminalStatus(status),
    isTerminalSuccess: isTerminalSuccess(status),
    needsAttention: needsAttention(status),
    timeline: deriveStatusTimeline(response),
    settlement: deriveSettlementReceipt(response),
    recovery: deriveDefaultRecovery(response),
    selfRecovery: deriveSelfRecovery(response),
    agentVault: response.redemption.agentVault,
    agentDetails: response.redemption.agentDetails ?? emptyAgentDetails,
    redeemer: response.redemption.redeemer,
    paymentReference: response.redemption.paymentReference,
    generatedAt: response.generatedAt,
  };
}
