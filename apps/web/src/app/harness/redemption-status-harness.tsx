"use client";

import { RedemptionStatusView } from "@/components/status/redemption-status-view";
import { SelfRecoveryPanelView } from "@/components/status/self-recovery-panel-view";
import type { StatusFreshness } from "@/components/status/redemption-status-view";
import type { ReactNode } from "react";

import {
  HARNESS_DEFAULT_TX_HASH,
  HARNESS_REDEEM_TX_HASH,
  HARNESS_REDEEM_WITH_TAG_TX_HASH,
  RECOVERED_VIEW_MODEL,
  RECOVERY_VIEW_MODEL,
  SETTLED_VIEW_MODEL,
  WITH_TAG_SETTLED_VIEW_MODEL,
} from "./harness-data";

type StatusVariant = "settled" | "recovery" | "recovered" | "with-tag-settled";

const FRESH_NOW: StatusFreshness = {
  polling: false,
  isFetching: false,
  isStale: false,
  staleReason: null,
  lastUpdatedLabel: "just now",
};

const noop = () => undefined;

type VariantConfig = {
  requestId: string;
  viewModel: typeof SETTLED_VIEW_MODEL;
  transactionHash: string;
  selfRecoverySlot: ReactNode;
};

function buildConfig(variant: StatusVariant): VariantConfig {
  switch (variant) {
    case "settled":
      return {
        requestId: "38217645",
        viewModel: SETTLED_VIEW_MODEL,
        transactionHash: HARNESS_REDEEM_TX_HASH,
        selfRecoverySlot: undefined,
      };
    case "recovery":
      return {
        requestId: "38216902",
        viewModel: RECOVERY_VIEW_MODEL,
        transactionHash: HARNESS_REDEEM_TX_HASH,
        selfRecoverySlot: (
          <SelfRecoveryPanelView
            phase="ready"
            votingRoundId="12"
            fdcRequestStatus="PROOF_READY"
            defaultTransactionHash={null}
            submittedTransactionHash={null}
            errorMessage={null}
            onSubmit={noop}
            onRefresh={noop}
          />
        ),
      };
    case "recovered":
      return {
        requestId: "38216902",
        viewModel: RECOVERED_VIEW_MODEL,
        transactionHash: HARNESS_REDEEM_TX_HASH,
        selfRecoverySlot: (
          <SelfRecoveryPanelView
            phase="recovered"
            votingRoundId="12"
            fdcRequestStatus="PROOF_READY"
            defaultTransactionHash={HARNESS_DEFAULT_TX_HASH}
            submittedTransactionHash={null}
            errorMessage={null}
            onSubmit={noop}
            onRefresh={noop}
          />
        ),
      };
    case "with-tag-settled":
      return {
        requestId: "38220471",
        viewModel: WITH_TAG_SETTLED_VIEW_MODEL,
        transactionHash: HARNESS_REDEEM_WITH_TAG_TX_HASH,
        selfRecoverySlot: undefined,
      };
  }
}

export function RedemptionStatusHarness({
  variant,
}: {
  variant: StatusVariant;
}) {
  const config = buildConfig(variant);
  const viewModel = config.viewModel;

  const freshness: StatusFreshness = {
    ...FRESH_NOW,
    polling: !viewModel.isTerminal,
  };

  return (
    <RedemptionStatusView
      requestId={config.requestId}
      phase="ready"
      viewModel={viewModel}
      submission={{
        transactionHash: config.transactionHash,
        relatedRequests: [{ requestId: config.requestId, isCurrent: true }],
      }}
      freshness={freshness}
      errorMessage={null}
      errorRequestId={null}
      selfRecoverySlot={config.selfRecoverySlot}
    />
  );
}
