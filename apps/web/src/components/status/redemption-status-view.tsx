import type { ReactNode } from "react";
import Link from "next/link";

import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { coston2AddressUrl, coston2TransactionUrl } from "@/lib/chain";
import { formatAddress, formatHash, formatUtcTimestamp } from "@/lib/format";
import type {
  DefaultRecoveryInfo,
  RedemptionStatusViewModel,
  RelatedRequest,
  SettlementReceipt,
  TimelineStep,
  TimelineStepState,
} from "@/lib/redemption-status";

/**
 * Presentational status view. It is a pure function of its props — no fetching,
 * polling, or wallet state — so the container ({@link RedemptionStatus}) can
 * wire live data in and every phase (loading, empty, not-found, error, ready)
 * and status can be rendered directly in component tests. It mirrors the
 * container/view split already used by the redemption form.
 */

export type StatusViewPhase =
  "empty" | "loading" | "not-found" | "error" | "ready";

/** Freshness metadata for the polling/last-updated/stale indicators. */
export type StatusFreshness = Readonly<{
  /** Whether live polling is currently active (stops on terminal states). */
  polling: boolean;
  /** Whether a refresh is in flight right now. */
  isFetching: boolean;
  /** Whether the on-screen data may be out of date. */
  isStale: boolean;
  staleReason: "refetch-failed" | "age" | null;
  /** Relative label for when the data was last successfully loaded. */
  lastUpdatedLabel: string | null;
}>;

/** Details preserved from the redemption submission (Prompt #17 query params). */
export type StatusSubmission = Readonly<{
  transactionHash: string | null;
  relatedRequests: readonly RelatedRequest[];
}>;

/** The all-zero EVM address, used before an agent has been indexed. */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Whether a vault address is a real, protocol-assigned agent (not the zero sentinel). */
function isAssignedAgent(agentVault: string): boolean {
  return agentVault !== "" && agentVault.toLowerCase() !== ZERO_ADDRESS;
}

export type RedemptionStatusViewProps = Readonly<{
  requestId: string;
  phase: StatusViewPhase;
  viewModel: RedemptionStatusViewModel | null;
  submission: StatusSubmission;
  freshness: StatusFreshness;
  errorMessage: string | null;
  errorRequestId: string | null;
  onRetry?: () => void;
  /**
   * Live self-recovery transaction control (Prompt #20). Injected by the
   * container so this view stays pure and free of wallet state — mirroring how
   * the redemption form injects its agent picker. Rendered in the ready phase
   * when the redemption is on the recovery track.
   */
  selfRecoverySlot?: ReactNode;
}>;

export function RedemptionStatusView({
  requestId,
  phase,
  viewModel,
  submission,
  freshness,
  errorMessage,
  errorRequestId,
  onRetry,
  selfRecoverySlot,
}: RedemptionStatusViewProps) {
  const showFreshness = phase === "ready" && viewModel !== null;

  return (
    <div>
      <PageHeader
        title="Redemption status"
        description={
          requestId === "" ? (
            "Live redemption status, settlement receipt, and default recovery."
          ) : (
            <>
              Request <span className="font-mono break-all">{requestId}</span>
            </>
          )
        }
        actions={
          showFreshness ? (
            <FreshnessIndicator
              freshness={freshness}
              isTerminal={viewModel.isTerminal}
            />
          ) : undefined
        }
      />

      {phase === "empty" ? <EmptyPhase /> : null}
      {phase === "loading" ? <LoadingPhase /> : null}
      {phase === "not-found" ? (
        <NotFoundPhase requestId={requestId} onRetry={onRetry} />
      ) : null}
      {phase === "error" ? (
        <ErrorPhase
          message={errorMessage}
          requestId={errorRequestId}
          onRetry={onRetry}
        />
      ) : null}

      {phase === "ready" && viewModel !== null ? (
        <ReadyPhase
          viewModel={viewModel}
          submission={submission}
          freshness={freshness}
          selfRecoverySlot={selfRecoverySlot}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

function EmptyPhase() {
  return (
    <EmptyState
      title="No redemption selected"
      description="Enter a redemption request id on the console to track its settlement and recovery status."
    >
      <Link
        href="/"
        className="text-sm font-medium text-accent hover:underline"
      >
        Go to the redemption console
      </Link>
    </EmptyState>
  );
}

function LoadingPhase() {
  return (
    <Card>
      <Spinner label="Loading redemption status" />
    </Card>
  );
}

function NotFoundPhase({
  requestId,
  onRetry,
}: {
  requestId: string;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <EmptyState
      title="Redemption not found"
      description={
        <>
          No redemption with id{" "}
          <span className="font-mono break-all">{requestId}</span> was found. It
          may not be indexed yet, or the id may be incorrect.
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-center gap-3">
        {onRetry !== undefined ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Check again
          </Button>
        ) : null}
        <Link
          href="/"
          className="text-sm font-medium text-accent hover:underline"
        >
          Back to console
        </Link>
      </div>
    </EmptyState>
  );
}

function ErrorPhase({
  message,
  requestId,
  onRetry,
}: {
  message: string | null;
  requestId: string | null;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <Callout
      tone="danger"
      title="Couldn't load redemption status"
      actions={
        onRetry !== undefined ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      <p>{message ?? "The Harbor API request failed. Please try again."}</p>
      {requestId !== null ? (
        <p className="mt-1 text-xs opacity-80">
          Request id: <span className="font-mono">{requestId}</span>
        </p>
      ) : null}
    </Callout>
  );
}

function ReadyPhase({
  viewModel,
  submission,
  freshness,
  selfRecoverySlot,
}: {
  viewModel: RedemptionStatusViewModel;
  submission: StatusSubmission;
  freshness: StatusFreshness;
  selfRecoverySlot?: ReactNode;
}) {
  const hasNoActivity =
    viewModel.settlement === null && viewModel.recovery === null;

  return (
    <div className="flex flex-col gap-4">
      {freshness.isStale ? <StaleBanner freshness={freshness} /> : null}

      <StatusSummary viewModel={viewModel} />

      {viewModel.needsAttention ? (
        <AttentionBanner
          statusLabel={viewModel.statusLabel}
          statusReason={viewModel.statusReason}
        />
      ) : null}

      <AssignedAgentCard agentVault={viewModel.agentVault} />

      <TimelineCard steps={viewModel.timeline} />

      {viewModel.settlement !== null ? (
        <SettlementReceiptCard receipt={viewModel.settlement} />
      ) : null}

      {viewModel.recovery !== null ? (
        <DefaultRecoveryCard recovery={viewModel.recovery} />
      ) : null}

      {selfRecoverySlot ?? null}

      {hasNoActivity && !viewModel.needsAttention ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No settlement receipt or default-recovery activity yet — this
          redemption is still in progress.
        </p>
      ) : null}

      {submission.relatedRequests.length > 1 ? (
        <RelatedRequestsCard related={submission.relatedRequests} />
      ) : null}

      <SubmissionDetailsCard transactionHash={submission.transactionHash} />

      <HonestCopyFooter />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

function FreshnessIndicator({
  freshness,
  isTerminal,
}: {
  freshness: StatusFreshness;
  isTerminal: boolean;
}) {
  const live = freshness.polling && !isTerminal;
  const label = isTerminal ? "Final" : live ? "Live" : "Paused";

  return (
    <div
      className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-2 w-2 rounded-full",
          live
            ? "animate-pulse bg-emerald-500"
            : "bg-gray-400 dark:bg-gray-600",
        )}
      />
      <span>{label}</span>
      {freshness.lastUpdatedLabel !== null ? (
        <span className="text-gray-400 dark:text-gray-500">
          · Updated {freshness.lastUpdatedLabel}
        </span>
      ) : null}
      {freshness.isFetching ? (
        <span className="sr-only">Refreshing status</span>
      ) : null}
    </div>
  );
}

function StaleBanner({ freshness }: { freshness: StatusFreshness }) {
  const message =
    freshness.staleReason === "refetch-failed"
      ? "Showing the last known status — reconnecting to the Harbor API."
      : "This status may be out of date.";

  return (
    <Callout tone="warning" title="Data may be stale">
      <p>
        {message}
        {freshness.lastUpdatedLabel !== null
          ? ` Last updated ${freshness.lastUpdatedLabel}.`
          : ""}
      </p>
    </Callout>
  );
}

// ---------------------------------------------------------------------------
// Summary + attention
// ---------------------------------------------------------------------------

function StatusSummary({
  viewModel,
}: {
  viewModel: RedemptionStatusViewModel;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={viewModel.statusTone}>{viewModel.statusLabel}</Badge>
            {viewModel.isTerminalSuccess ? (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Terminal
              </span>
            ) : null}
          </div>
          {viewModel.statusReason !== null && !viewModel.needsAttention ? (
            // When attention is needed the reason is shown in the banner below,
            // so it is not repeated here.
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              {viewModel.statusReason}
            </p>
          ) : null}
        </div>
        <dl className="text-xs text-gray-500 dark:text-gray-400 sm:text-right">
          <dt className="sr-only">Snapshot generated at</dt>
          <dd>Snapshot {formatUtcTimestamp(viewModel.generatedAt)}</dd>
        </dl>
      </div>
    </Card>
  );
}

function AttentionBanner({
  statusLabel,
  statusReason,
}: {
  statusLabel: string;
  statusReason: string | null;
}) {
  return (
    <Callout tone="danger" title={`${statusLabel} — manual attention needed`}>
      <p>
        {statusReason ??
          "This redemption did not complete automatically. Default recovery is enforced by FDC and the AssetManager; if it cannot proceed, manual follow-up may be required."}
      </p>
    </Callout>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const STEP_STATE_META: Record<
  TimelineStepState,
  { srLabel: string; dot: string; text: string }
> = {
  complete: {
    srLabel: "Completed",
    dot: "bg-emerald-500 border-emerald-500",
    text: "text-gray-900 dark:text-gray-100",
  },
  current: {
    srLabel: "In progress",
    dot: "bg-accent border-accent ring-4 ring-accent/20",
    text: "font-semibold text-gray-900 dark:text-gray-100",
  },
  upcoming: {
    srLabel: "Upcoming",
    dot: "bg-transparent border-gray-300 dark:border-gray-600",
    text: "text-gray-400 dark:text-gray-500",
  },
  skipped: {
    srLabel: "Not recorded",
    dot: "bg-gray-200 border-gray-200 dark:bg-gray-700 dark:border-gray-700",
    text: "text-gray-400 dark:text-gray-500",
  },
  attention: {
    srLabel: "Needs attention",
    dot: "bg-red-500 border-red-500",
    text: "font-semibold text-red-700 dark:text-red-300",
  },
};

function TimelineCard({ steps }: { steps: readonly TimelineStep[] }) {
  return (
    <Card>
      <CardHeader
        title="Status timeline"
        description="Milestones are recorded from on-chain and XRPL evidence, oldest first."
      />
      <ol className="flex flex-col">
        {steps.map((step, index) => (
          <TimelineItem
            key={`${step.status}-${index}`}
            step={step}
            isLast={index === steps.length - 1}
          />
        ))}
      </ol>
    </Card>
  );
}

function TimelineItem({
  step,
  isLast,
}: {
  step: TimelineStep;
  isLast: boolean;
}) {
  const meta = STEP_STATE_META[step.state];
  const muted = step.state === "upcoming" || step.state === "skipped";

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={cn("mt-1 h-3 w-3 shrink-0 rounded-full border", meta.dot)}
        />
        {!isLast ? (
          <span
            aria-hidden="true"
            className="my-1 w-px grow bg-gray-200 dark:bg-gray-800"
          />
        ) : null}
      </div>

      <div className={cn("pb-5", isLast && "pb-0")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-sm", meta.text)}>{step.label}</span>
          <span className="sr-only">({meta.srLabel})</span>
          {step.state === "current" ? (
            <Badge tone="progress">Current</Badge>
          ) : null}
          {step.state === "skipped" ? (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              Not recorded
            </span>
          ) : null}
        </div>
        <p
          className={cn(
            "mt-0.5 text-xs",
            muted
              ? "text-gray-400 dark:text-gray-500"
              : "text-gray-500 dark:text-gray-400",
          )}
        >
          {step.description}
        </p>
        {step.occurredAt !== null && !muted ? (
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
            {formatUtcTimestamp(step.occurredAt)}
          </p>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Settlement receipt
// ---------------------------------------------------------------------------

function SettlementReceiptCard({ receipt }: { receipt: SettlementReceipt }) {
  return (
    <Card>
      <CardHeader
        title="Settlement receipt"
        description={
          receipt.observationCount > 1
            ? `${receipt.observationCount} XRPL payments observed for this request.`
            : "Observed XRPL payment for this redemption."
        }
      />
      <dl className="flex flex-col gap-3 text-sm">
        <DetailRow label="XRPL tx hash">
          <PlainHash value={receipt.transactionHash} />
        </DetailRow>
        <DetailRow label="Amount delivered">
          <span className="font-mono">{receipt.deliveredAmountLabel}</span>
        </DetailRow>
        <DetailRow label="Ledger index">
          <span className="font-mono">{receipt.ledgerIndex}</span>
        </DetailRow>
        <DetailRow label="Ledger close">
          <span className="font-mono">
            {formatUtcTimestamp(receipt.closeTimestamp)}
          </span>
        </DetailRow>
        <DetailRow label="Agent vault">
          <AddressLink address={receipt.agentVault} />
        </DetailRow>
        <DetailRow label="Payment reference">
          <PlainHash value={receipt.paymentReference} />
        </DetailRow>
      </dl>
      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        XRPL observation is recorded for visibility only. Settlement and default
        recovery are enforced on-chain by FDC attestations and the FAssets
        AssetManager — not by this observation.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Default recovery
// ---------------------------------------------------------------------------

function DefaultRecoveryCard({ recovery }: { recovery: DefaultRecoveryInfo }) {
  return (
    <Card>
      <CardHeader
        title="Default recovery"
        description="Non-payment recovery via a Flare Data Connector proof."
      />
      <dl className="flex flex-col gap-3 text-sm">
        <DetailRow label="FDC request status">
          {recovery.fdcRequestStatus !== null ? (
            <Badge tone="progress">{recovery.fdcRequestStatus}</Badge>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">
              Not requested yet
            </span>
          )}
        </DetailRow>
        <DetailRow label="Proof">
          {recovery.proofReady ? (
            <Badge tone="success">Ready</Badge>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">Pending</span>
          )}
        </DetailRow>
        {recovery.votingRoundId !== null ? (
          <DetailRow label="FDC voting round">
            <span className="font-mono">{recovery.votingRoundId}</span>
          </DetailRow>
        ) : null}
        <DetailRow label="Default tx hash">
          {recovery.defaultTransactionHash !== null ? (
            <TxLink hash={recovery.defaultTransactionHash} />
          ) : (
            <span className="text-gray-400 dark:text-gray-500">
              Not submitted yet
            </span>
          )}
        </DetailRow>
        <DetailRow label="Recovered">
          {recovery.recovered ? (
            <Badge tone="success">Recovered</Badge>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">
              In progress
            </span>
          )}
        </DetailRow>
      </dl>
      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        Default recovery is enforced by FDC proofs and the AssetManager. The
        Harbor keeper submits the default permissionlessly; Harbor never
        custodies funds or decides outcomes.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Related requests + submission details
// ---------------------------------------------------------------------------

function RelatedRequestsCard({
  related,
}: {
  related: readonly RelatedRequest[];
}) {
  return (
    <Card>
      <CardHeader
        title="Related requests"
        description="One redemption can be filled from multiple agents, creating several request ids."
      />
      <ul className="flex flex-col gap-2 text-sm">
        {related.map((item) => (
          <li
            key={item.requestId}
            className="flex items-center justify-between gap-4"
          >
            {item.isCurrent ? (
              <span className="font-mono text-gray-900 dark:text-gray-100">
                {item.requestId}
              </span>
            ) : (
              <Link
                href={`/status/${encodeURIComponent(item.requestId)}`}
                className="font-mono text-accent hover:underline"
              >
                {item.requestId}
              </Link>
            )}
            {item.isCurrent ? (
              <Badge tone="info">Viewing</Badge>
            ) : (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                View status
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Protocol-assigned agent. FAssets assigns redemption agents automatically
 * (FIFO) — the redeemer never chooses one — so this is shown as a fact read
 * from indexed protocol data, with copy making clear Harbor only monitors the
 * assigned agent. Rendered only once a real agent has been indexed (i.e. not
 * the zero sentinel).
 */
function AssignedAgentCard({ agentVault }: { agentVault: string }) {
  if (!isAssignedAgent(agentVault)) {
    return null;
  }

  return (
    <Card>
      <CardHeader
        title="Assigned agent"
        description="Selected automatically by the FAssets protocol (FIFO)."
      />
      <dl className="flex flex-col gap-3 text-sm">
        <DetailRow label="Vault address">
          <AddressLink address={agentVault} />
        </DetailRow>
      </dl>
      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        The FAssets protocol assigned this agent from the front of the FIFO
        redemption queue. You did not choose it — Harbor only monitors the
        assigned agent&apos;s settlement and, if it fails to pay, its default
        recovery.
      </p>
    </Card>
  );
}

function SubmissionDetailsCard({
  transactionHash,
}: {
  transactionHash: string | null;
}) {
  if (transactionHash === null) {
    return null;
  }

  return (
    <Card>
      <CardHeader
        title="Submission details"
        description="Preserved from the redemption submission."
      />
      <dl className="flex flex-col gap-3 text-sm">
        <DetailRow label="Redeem transaction">
          <TxLink hash={transactionHash} />
        </DetailRow>
      </dl>
    </Card>
  );
}

function HonestCopyFooter() {
  return (
    <p className="text-xs text-gray-400 dark:text-gray-500">
      Agent reliability scores shown elsewhere are a heuristic, not a guarantee.
      XRPL observation is for status visibility; FDC and the AssetManager
      enforce default recovery.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Shared value renderers
// ---------------------------------------------------------------------------

function DetailRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="break-all sm:text-right">{children}</dd>
    </div>
  );
}

function PlainHash({ value }: { value: string }) {
  return (
    <span className="font-mono" title={value}>
      {formatHash(value)}
    </span>
  );
}

function TxLink({ hash }: { hash: string }) {
  return (
    <a
      href={coston2TransactionUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
      title={hash}
      className="font-mono text-accent hover:underline"
    >
      {formatHash(hash)}
    </a>
  );
}

function AddressLink({ address }: { address: string }) {
  return (
    <a
      href={coston2AddressUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
      title={address}
      className="font-mono text-accent hover:underline"
    >
      {formatAddress(address)}
    </a>
  );
}
