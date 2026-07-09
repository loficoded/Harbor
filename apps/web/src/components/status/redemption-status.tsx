"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  RedemptionStatusView,
  type StatusFreshness,
  type StatusViewPhase,
} from "@/components/status/redemption-status-view";
import { SelfRecoveryPanel } from "@/components/status/self-recovery-panel";
import { createHarborApiClient, HarborApiError } from "@/lib/api-client";
import { getClientEnv } from "@/lib/env";
import { formatRelativeTime } from "@/lib/format";
import {
  buildRelatedRequests,
  deriveRedemptionStatusViewModel,
  isRedemptionResponse,
  isTerminalStatus,
} from "@/lib/redemption-status";

/**
 * Live redemption status container. Fetches `GET /redemptions/:id` (Prompt #15)
 * with TanStack Query and polls until the redemption reaches a terminal state.
 *
 * Polling — not SSE — is used deliberately: the backend exposes no event-stream
 * endpoint, and this prompt does not add one. The poll interval stops once the
 * status is terminal (settled, recovered, or failed) so a finished redemption
 * costs no further requests.
 *
 * All rendering (loading, empty, not-found, error, stale, and the full status
 * timeline) lives in the pure {@link RedemptionStatusView}; this component only
 * wires live query state, derives the view model, and computes freshness.
 */

/** Poll cadence while the redemption is non-terminal. */
const POLL_INTERVAL_MS = 5_000;

/** Data older than this (while still polling) is surfaced as possibly stale. */
const STALE_THRESHOLD_MS = 20_000;

export type RedemptionStatusProps = Readonly<{
  requestId: string;
  additionalRequestIds?: readonly string[];
  transactionHash?: string | null;
  preferredAgent?: string | null;
}>;

export function RedemptionStatus({
  requestId,
  additionalRequestIds = [],
  transactionHash = null,
  preferredAgent = null,
}: RedemptionStatusProps) {
  const client = useMemo(() => createHarborApiClient(), []);
  const enabled = requestId !== "";

  const query = useQuery({
    queryKey: ["redemption", requestId],
    queryFn: ({ signal }) => client.getRedemption(requestId, signal),
    enabled,
    // Poll while non-terminal; stop once the redemption settles/recovers/fails.
    // Guard the payload shape here too: a malformed response must not throw
    // inside the poll scheduler.
    refetchInterval: (currentQuery) => {
      const current = currentQuery.state.data;
      const status =
        current !== undefined && isRedemptionResponse(current)
          ? current.redemption.status
          : undefined;
      if (status !== undefined && isTerminalStatus(status)) {
        return false;
      }
      return POLL_INTERVAL_MS;
    },
    // A missing redemption is a definitive answer, not a transient failure.
    retry: (failureCount, error) => {
      if (error instanceof HarborApiError && error.status === 404) {
        return false;
      }
      return failureCount < 2;
    },
  });

  // Tick so the "last updated" label and age-based staleness update live.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [enabled]);

  const data = query.data;
  const hasData = data !== undefined;
  // A well-formed response is required to render the timeline; an unexpected
  // shape is treated as an API error rather than crashing the view.
  const malformed = hasData && !isRedemptionResponse(data);
  const is404 =
    query.error instanceof HarborApiError && query.error.status === 404;

  const viewModel = useMemo(
    () =>
      data !== undefined && isRedemptionResponse(data)
        ? deriveRedemptionStatusViewModel(data)
        : null,
    [data],
  );

  const phase = resolvePhase({
    enabled,
    hasValidData: viewModel !== null,
    malformed,
    isError: query.isError,
    is404,
  });

  const isTerminal = viewModel?.isTerminal ?? false;
  const dataUpdatedAt = query.dataUpdatedAt;
  const lastUpdatedLabel =
    hasData && dataUpdatedAt > 0
      ? formatRelativeTime(dataUpdatedAt, nowMs)
      : null;

  const refetchFailed = hasData && query.isError;
  const ageStale =
    hasData &&
    !isTerminal &&
    dataUpdatedAt > 0 &&
    nowMs - dataUpdatedAt > STALE_THRESHOLD_MS;

  const freshness: StatusFreshness = {
    polling: hasData && !isTerminal,
    isFetching: query.isFetching,
    isStale: refetchFailed || ageStale,
    staleReason: refetchFailed ? "refetch-failed" : ageStale ? "age" : null,
    lastUpdatedLabel,
  };

  const relatedRequests = buildRelatedRequests(requestId, additionalRequestIds);

  const errorMessage = malformed
    ? "The Harbor API returned an unexpected response."
    : query.error instanceof Error
      ? query.error.message
      : null;
  const errorRequestId =
    query.error instanceof HarborApiError ? query.error.requestId : null;

  // Permissionless self-recovery (Prompt #20). The panel is a client component
  // (wallet/chain state), so it is injected into the pure view as a slot. The
  // HarborRedeemer address comes from the frontend env; when unset the panel
  // reports the contract as unconfigured. The panel stays mounted across an
  // in-session RECOVERED transition (sticky ref) so the recovered confirmation
  // is shown after a submission, while a freshly-loaded recovered/settled
  // redemption shows no actionable control.
  const env = useMemo(() => getClientEnv(), []);
  const recoveryPanelSeenRef = useRef(false);
  if (viewModel?.selfRecovery.visible === true) {
    recoveryPanelSeenRef.current = true;
  }
  const showSelfRecovery =
    viewModel !== null &&
    (viewModel.selfRecovery.visible ||
      (recoveryPanelSeenRef.current && viewModel.selfRecovery.recovered));

  const selfRecoverySlot =
    showSelfRecovery && viewModel !== null ? (
      <SelfRecoveryPanel
        requestId={requestId}
        selfRecovery={viewModel.selfRecovery}
        harborRedeemerAddress={env.contractAddress}
        onRecoveryRefresh={() => {
          void query.refetch();
        }}
      />
    ) : undefined;

  return (
    <RedemptionStatusView
      requestId={requestId}
      phase={phase}
      viewModel={viewModel}
      submission={{ transactionHash, preferredAgent, relatedRequests }}
      freshness={freshness}
      errorMessage={errorMessage}
      errorRequestId={errorRequestId}
      onRetry={() => {
        void query.refetch();
      }}
      selfRecoverySlot={selfRecoverySlot}
    />
  );
}

function resolvePhase(input: {
  enabled: boolean;
  hasValidData: boolean;
  malformed: boolean;
  isError: boolean;
  is404: boolean;
}): StatusViewPhase {
  if (!input.enabled) {
    return "empty";
  }
  if (input.hasValidData) {
    // Once we have valid data we keep showing it; a failed refresh -> "stale".
    return "ready";
  }
  if (input.malformed) {
    return "error";
  }
  if (input.isError) {
    return input.is404 ? "not-found" : "error";
  }
  return "loading";
}
