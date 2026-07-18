import {
  emptyAgentDetails,
  serializeBigint,
  type AgentDetails,
  type AgentScoreView,
  type AgentsResponseData,
  type FdcProofRecord,
  type FdcRequestRecord,
  type HealthDatabaseComponent,
  type HealthFdcComponent,
  type HealthIndexerComponent,
  type HealthKeeperComponent,
  type HealthReport,
  type HealthReportStatus,
  type IsoTimestamp,
  type RedemptionDetail,
  type RedemptionResponseData,
  type RedemptionStatus,
  type RedemptionTimelineEntry,
  type RedemptionTimelineSource,
  type XrplPaymentObservation,
} from "@harbor/shared";

import { listAppliedMigrations, type SqliteDatabase } from "../db/index.js";
import { buildFAssetIndexerCursorName } from "../indexer/index.js";
import { nowIso } from "../repositories/common.js";
import {
  getAgent,
  getLatestFdcRound,
  getRedemptionByRequestId,
  getSyncCursor,
  listAgentReliabilityScores,
  listAgents,
  listFdcProofsForRedemption,
  listFdcRequestsForRedemption,
  listXrplObservationsForRedemption,
  summarizeKeeperJobs,
  type StoredAgentReliabilityScoreRecord,
  type StoredFdcProofRecord,
  type StoredFdcRequestRecord,
  type StoredRedemptionRequest,
  type StoredXrplPaymentObservation,
} from "../repositories/index.js";
import type { ApiServerConfig } from "./config.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/**
 * Project a stored Prompt #10 reliability record onto the public score view.
 * `scoreIsHeuristic` is pinned to `true`: the score is a transparent heuristic,
 * never a settlement guarantee.
 *
 * Official agent details (name/icon/description/terms) are joined from the
 * indexed agent inventory and passed in by the caller. They default to
 * `emptyAgentDetails` when the agent has published none, so the leaderboard
 * always has a value to fall back on.
 */
export function toAgentScoreView(
  record: StoredAgentReliabilityScoreRecord,
  details: AgentDetails = emptyAgentDetails,
): AgentScoreView {
  return {
    agentVault: record.agentVault,
    score: record.score,
    scoreIsHeuristic: true,
    formulaVersion: record.formulaVersion,
    fulfillmentRate: record.fulfillmentRate,
    fulfillmentScore: record.fulfillmentScore,
    settlementTimeScore: record.settlementTimeScore,
    defaultPenalty: record.defaultPenalty,
    availabilityScore: record.availabilityScore,
    collateralScore: record.collateralScore,
    successfulRedemptions: record.successfulRedemptions,
    defaultedRedemptions: record.defaultedRedemptions,
    totalTerminalRedemptions: record.totalTerminalRedemptions,
    averageSettlementSeconds: record.averageSettlementSeconds,
    availability: record.availability,
    availableLots: record.availableLots,
    collateralRatioBips: record.collateralRatioBips,
    collateralRatioSource: record.collateralRatioSource,
    ftsoStatus: record.ftsoStatus,
    details,
    updatedAt: record.updatedAt,
  };
}

/**
 * Ranked agent score records for the given asset. Records arrive already
 * ordered by score (descending) then vault address from the repository, which
 * is the ranking the frontend renders. Each score is joined with its indexed
 * agent record so official `AgentDetails` ride along on the leaderboard; a
 * score with no matching agent (or no published details) falls back to
 * `emptyAgentDetails`.
 */
export function buildAgentsResponseData(
  database: SqliteDatabase,
  asset: string,
): AgentsResponseData {
  const records = listAgentReliabilityScores(database);
  const detailsByVault = new Map(
    listAgents(database).map((agent) => [agent.agentVault, agent.details]),
  );

  return {
    asset,
    scoreIsHeuristic: true,
    agents: records.map((record) =>
      toAgentScoreView(
        record,
        detailsByVault.get(record.agentVault) ?? emptyAgentDetails,
      ),
    ),
    generatedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Redemption detail
// ---------------------------------------------------------------------------

function toRedemptionDetail(
  record: StoredRedemptionRequest,
  agentDetails: AgentDetails = emptyAgentDetails,
): RedemptionDetail {
  return {
    requestId: record.requestId,
    assetManagerAddress: record.assetManagerAddress,
    status: record.status,
    statusReason: record.statusReason,
    redeemer: record.redeemer,
    agentVault: record.agentVault,
    agentDetails,
    paymentAddress: record.paymentAddress,
    redemptionKind: record.redemptionKind,
    destinationTag: record.destinationTag,
    valueUBA: record.valueUBA,
    feeUBA: record.feeUBA,
    paymentReference: record.paymentReference,
    transactionHash: record.transactionHash,
    defaultTransactionHash: record.defaultTransactionHash,
    executor: record.executor,
    executorFeeNatWei: record.executorFeeNatWei,
    firstUnderlyingBlock: record.firstUnderlyingBlock,
    lastUnderlyingBlock: record.lastUnderlyingBlock,
    lastUnderlyingTimestamp: record.lastUnderlyingTimestamp,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// Project stored rows onto their public domain shape so storage-only fields
// (raw payloads, retry bookkeeping, asset-manager scoping) never leak on-wire.
function toXrplReceipt(
  record: StoredXrplPaymentObservation,
): XrplPaymentObservation {
  return {
    observationId: record.observationId,
    redemptionRequestId: record.redemptionRequestId,
    transactionHash: record.transactionHash,
    sourceAddress: record.sourceAddress,
    destinationAddress: record.destinationAddress,
    deliveredAmountUBA: record.deliveredAmountUBA,
    feeDrops: record.feeDrops,
    paymentReference: record.paymentReference,
    ledgerIndex: record.ledgerIndex,
    closeTimestamp: record.closeTimestamp,
    validatedAt: record.validatedAt,
    destinationTag: record.destinationTag,
    createdAt: record.createdAt,
  };
}

function toFdcRequest(record: StoredFdcRequestRecord): FdcRequestRecord {
  return {
    fdcRequestId: record.fdcRequestId,
    redemptionRequestId: record.redemptionRequestId,
    attestationType: record.attestationType,
    sourceId: record.sourceId,
    requestBody: record.requestBody,
    requestHash: record.requestHash,
    status: record.status,
    votingRoundId: record.votingRoundId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toFdcProof(record: StoredFdcProofRecord): FdcProofRecord {
  return {
    fdcProofId: record.fdcProofId,
    fdcRequestId: record.fdcRequestId,
    redemptionRequestId: record.redemptionRequestId,
    requestHash: record.requestHash,
    responseBody: record.responseBody,
    merkleProof: record.merkleProof,
    votingRoundId: record.votingRoundId,
    createdAt: record.createdAt,
  };
}

/**
 * Build an ordered (oldest-first) status timeline from concrete stored
 * evidence rather than an inferred state path: the request itself, XRPL
 * settlement receipts, FDC proof requests, retrieved proofs, and a submitted
 * default. The current status is always represented as the final milestone.
 */
export function buildRedemptionTimeline(
  redemption: StoredRedemptionRequest,
  observations: readonly StoredXrplPaymentObservation[],
  fdcRequests: readonly StoredFdcRequestRecord[],
  fdcProofs: readonly StoredFdcProofRecord[],
): readonly RedemptionTimelineEntry[] {
  const entries: RedemptionTimelineEntry[] = [];
  const seenStatuses = new Set<RedemptionStatus>();

  const add = (
    status: RedemptionStatus,
    occurredAt: IsoTimestamp,
    source: RedemptionTimelineSource,
    detail: string | null,
  ): void => {
    entries.push({ status, occurredAt, source, detail });
    seenStatuses.add(status);
  };

  add(
    "REQUESTED",
    redemption.createdAt,
    "REDEMPTION",
    "Redemption request recorded",
  );

  for (const observation of observations) {
    add(
      "SETTLED",
      observation.validatedAt,
      "XRPL_OBSERVATION",
      `XRPL payment ${observation.transactionHash}`,
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
      proof.proofReadyAt ?? proof.createdAt,
      "FDC_PROOF",
      `FDC round ${proof.votingRoundId.toString()}`,
    );
  }

  if (redemption.defaultTransactionHash !== null) {
    add(
      "DEFAULT_SUBMITTED",
      redemption.updatedAt,
      "KEEPER",
      `Default transaction ${redemption.defaultTransactionHash}`,
    );
  }

  if (!seenStatuses.has(redemption.status)) {
    add(
      redemption.status,
      redemption.updatedAt,
      "REDEMPTION",
      redemption.statusReason,
    );
  }

  // Stable sort ascending by ISO timestamp (lexicographic works for the
  // millisecond-precision UTC strings the backend stores).
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      if (left.entry.occurredAt < right.entry.occurredAt) {
        return -1;
      }

      if (left.entry.occurredAt > right.entry.occurredAt) {
        return 1;
      }

      return left.index - right.index;
    })
    .map(({ entry }) => entry);
}

/**
 * Compose the full redemption detail payload, or `null` when no redemption
 * matches the request id.
 */
export function buildRedemptionResponseData(
  database: SqliteDatabase,
  requestId: string,
): RedemptionResponseData | null {
  const redemption = getRedemptionByRequestId(database, requestId);

  if (redemption === null) {
    return null;
  }

  const observations = listXrplObservationsForRedemption(database, requestId);
  const fdcRequests = listFdcRequestsForRedemption(database, requestId);
  const fdcProofs = listFdcProofsForRedemption(database, requestId);
  const agent = getAgent(database, redemption.agentVault);

  return {
    redemption: toRedemptionDetail(
      redemption,
      agent?.details ?? emptyAgentDetails,
    ),
    statusTimeline: buildRedemptionTimeline(
      redemption,
      observations,
      fdcRequests,
      fdcProofs,
    ),
    xrplReceipts: observations.map(toXrplReceipt),
    fdcRequests: fdcRequests.map(toFdcRequest),
    fdcProofs: fdcProofs.map(toFdcProof),
    defaultTransactionHash: redemption.defaultTransactionHash,
    generatedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

const emptyKeeperComponent: HealthKeeperComponent = {
  totalJobs: 0,
  pending: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  ready: 0,
  lastError: null,
  lastUpdatedAt: null,
};

function buildIndexerComponent(
  database: SqliteDatabase,
  config: ApiServerConfig,
): HealthIndexerComponent {
  const cursorName = buildFAssetIndexerCursorName(
    config.chainId,
    config.assetManagerAddress,
  );
  const cursor = getSyncCursor(database, cursorName);

  if (cursor === null) {
    return { cursor: null };
  }

  return {
    cursor: {
      cursorName: cursor.cursorName,
      chainId: cursor.chainId,
      blockNumber: cursor.blockNumber,
      logIndex: cursor.logIndex,
      updatedAt: cursor.updatedAt,
    },
  };
}

function buildKeeperComponent(
  database: SqliteDatabase,
  now: IsoTimestamp,
): HealthKeeperComponent {
  const summary = summarizeKeeperJobs(database, now);

  return {
    totalJobs: summary.total,
    pending: summary.pending,
    running: summary.running,
    succeeded: summary.succeeded,
    failed: summary.failed,
    ready: summary.ready,
    lastError: summary.lastError,
    lastUpdatedAt: summary.lastUpdatedAt,
  };
}

function buildFdcComponent(database: SqliteDatabase): HealthFdcComponent {
  const round = getLatestFdcRound(database);

  if (round === null) {
    return { lastRound: null };
  }

  return {
    lastRound: {
      votingRoundId: serializeBigint(round.votingRoundId),
      source: round.source,
      observedAt: round.observedAt,
    },
  };
}

export type BuildHealthReportOptions = Readonly<{
  now?: IsoTimestamp;
}>;

/**
 * Assemble the composed health report. The database is probed first (listing
 * applied migrations doubles as a connectivity check); if that throws, the
 * report is marked `error` with the database component describing the failure
 * and the remaining components left at their empty defaults.
 */
export function buildHealthReport(
  database: SqliteDatabase,
  config: ApiServerConfig,
  options: BuildHealthReportOptions = {},
): HealthReport {
  const checkedAt = options.now ?? nowIso();

  let databaseComponent: HealthDatabaseComponent;
  let indexer: HealthIndexerComponent = { cursor: null };
  let keeper: HealthKeeperComponent = emptyKeeperComponent;
  let fdc: HealthFdcComponent = { lastRound: null };

  try {
    const appliedMigrations = listAppliedMigrations(database);
    const latestMigration = appliedMigrations.at(-1) ?? null;

    databaseComponent = {
      status: "ok",
      migrationsApplied: appliedMigrations.length,
      latestMigrationId: latestMigration === null ? null : latestMigration.id,
      error: null,
    };

    indexer = buildIndexerComponent(database, config);
    keeper = buildKeeperComponent(database, checkedAt);
    fdc = buildFdcComponent(database);
  } catch (error) {
    databaseComponent = {
      status: "error",
      migrationsApplied: null,
      latestMigrationId: null,
      error: errorMessage(error),
    };
  }

  const status: HealthReportStatus =
    databaseComponent.status === "ok" ? "ok" : "error";

  return {
    status,
    checkedAt,
    api: { status: "ok" },
    database: databaseComponent,
    indexer,
    keeper,
    fdc,
    build: config.build,
  };
}
