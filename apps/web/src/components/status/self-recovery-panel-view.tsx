import type { ReactNode } from "react";

import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Spinner,
} from "@/components/ui";
import { coston2TransactionUrl } from "@/lib/chain";
import { formatHash } from "@/lib/format";
import type { StatusTone } from "@/lib/status";
import type { SelfRecoveryPhase } from "@/lib/self-recovery";

/**
 * Presentational self-recovery panel. It is a pure function of its props — no
 * wallet, chain, or fetching state — so every transaction state (proof not
 * ready, proof ready, wallet required, wrong network, submitting, submitted,
 * recovered, and the unusable-proof / unconfigured-contract edges) is directly
 * component-testable. The container ({@link SelfRecoveryPanel}) wires live
 * wagmi state into these props.
 *
 * Copy is deliberately honest about the permissionless design: anyone can land
 * the default, and if someone else does so first the user simply refreshes into
 * the recovered state rather than seeing an error.
 */

export type SelfRecoveryPanelViewProps = Readonly<{
  phase: SelfRecoveryPhase;
  votingRoundId: string | null;
  fdcRequestStatus: string | null;
  /** On-chain default tx hash observed by the backend (keeper/third party). */
  defaultTransactionHash: string | null;
  /** The user's own submitted default tx hash (from the local wallet write). */
  submittedTransactionHash: string | null;
  /** Error surfaced from the wallet/transaction attempt, if any. */
  errorMessage: string | null;
  onSubmit: () => void;
  onRefresh: () => void;
}>;

const PHASE_BADGE: Record<
  SelfRecoveryPhase,
  { tone: StatusTone; label: string }
> = {
  hidden: { tone: "neutral", label: "" },
  "proof-not-ready": { tone: "progress", label: "Proof not ready" },
  "proof-invalid": { tone: "danger", label: "Proof unavailable" },
  "contract-unconfigured": { tone: "warning", label: "Not configured" },
  "wallet-required": { tone: "info", label: "Wallet required" },
  "wrong-network": { tone: "warning", label: "Wrong network" },
  ready: { tone: "info", label: "Proof ready" },
  submitting: { tone: "progress", label: "Submitting" },
  submitted: { tone: "progress", label: "Default submitted" },
  recovered: { tone: "success", label: "Recovered" },
};

/** Whether the permissionless explainer is relevant for a given phase. */
function showsPermissionlessNote(phase: SelfRecoveryPhase): boolean {
  return (
    phase === "proof-not-ready" ||
    phase === "proof-invalid" ||
    phase === "wallet-required" ||
    phase === "wrong-network" ||
    phase === "ready"
  );
}

export function SelfRecoveryPanelView({
  phase,
  votingRoundId,
  fdcRequestStatus,
  defaultTransactionHash,
  submittedTransactionHash,
  errorMessage,
  onSubmit,
  onRefresh,
}: SelfRecoveryPanelViewProps) {
  if (phase === "hidden") {
    return null;
  }

  const badge = PHASE_BADGE[phase];
  const effectiveTxHash = submittedTransactionHash ?? defaultTransactionHash;

  return (
    <Card>
      <CardHeader
        title="Self-recovery"
        description="Submit the FDC non-payment proof yourself to trigger default recovery — no keeper required."
        actions={<Badge tone={badge.tone}>{badge.label}</Badge>}
      />

      <div className="flex flex-col gap-4 text-sm">
        <PhaseBody
          phase={phase}
          votingRoundId={votingRoundId}
          fdcRequestStatus={fdcRequestStatus}
          txHash={effectiveTxHash}
          errorMessage={errorMessage}
          onSubmit={onSubmit}
          onRefresh={onRefresh}
        />

        {showsPermissionlessNote(phase) ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            This action is permissionless: anyone — not just the original
            redeemer — can submit the proof, and the executor fee is paid to
            whoever lands the transaction. Recovery is enforced by the FDC proof
            and the AssetManager; Harbor never custodies funds.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function PhaseBody({
  phase,
  votingRoundId,
  fdcRequestStatus,
  txHash,
  errorMessage,
  onSubmit,
  onRefresh,
}: {
  phase: SelfRecoveryPhase;
  votingRoundId: string | null;
  fdcRequestStatus: string | null;
  txHash: string | null;
  errorMessage: string | null;
  onSubmit: () => void;
  onRefresh: () => void;
}): ReactNode {
  switch (phase) {
    case "proof-not-ready":
      return (
        <>
          <p className="text-gray-600 dark:text-gray-300">
            The FDC non-payment proof is still being prepared
            {fdcRequestStatus !== null ? ` (request ${fdcRequestStatus})` : ""}.
            The Harbor keeper and FDC pipeline request and finalize it
            automatically; this page updates on its own and the submit action
            unlocks as soon as the proof is available.
          </p>
          <div>
            <Button variant="secondary" size="sm" disabled aria-disabled="true">
              Submit default recovery
            </Button>
          </div>
        </>
      );

    case "proof-invalid":
      return (
        <>
          <Callout tone="danger" title="Proof cannot be submitted yet">
            <p>
              A proof was returned but could not be validated into a well-formed
              default call, so Harbor will not submit it. This usually clears
              once the keeper finalizes the proof.
            </p>
          </Callout>
          <div>
            <Button variant="secondary" size="sm" onClick={onRefresh}>
              Refresh proof status
            </Button>
          </div>
        </>
      );

    case "contract-unconfigured":
      return (
        <Callout tone="warning" title="Harbor contract not configured">
          <p>
            The HarborRedeemer contract address is not configured in this
            deployment, so the default cannot be submitted from the UI yet.
            Recovery is still permissionless on-chain via{" "}
            <span className="font-mono">executeDefault</span>.
          </p>
        </Callout>
      );

    case "wallet-required":
      return (
        <>
          <p className="text-gray-600 dark:text-gray-300">
            The FDC proof is ready
            {votingRoundId !== null ? ` (round ${votingRoundId})` : ""}. Connect
            a wallet to submit the default recovery.
          </p>
          <div>
            <Button variant="secondary" size="sm" disabled aria-disabled="true">
              Submit default recovery
            </Button>
          </div>
        </>
      );

    case "wrong-network":
      return (
        <>
          <p className="text-gray-600 dark:text-gray-300">
            The FDC proof is ready. Switch your wallet to Coston2 to submit the
            default recovery.
          </p>
          <div>
            <Button variant="secondary" size="sm" disabled aria-disabled="true">
              Submit default recovery
            </Button>
          </div>
        </>
      );

    case "ready":
      return (
        <>
          <p className="text-gray-600 dark:text-gray-300">
            The FDC non-payment proof is ready
            {votingRoundId !== null ? ` (round ${votingRoundId})` : ""}.
            Submitting sends{" "}
            <span className="font-mono">HarborRedeemer.executeDefault</span>{" "}
            with the proof; the AssetManager releases your redemption
            collateral.
          </p>
          {errorMessage !== null ? (
            <Callout tone="danger" title="Transaction failed">
              <p>{errorMessage}</p>
              <p className="mt-1 text-xs opacity-80">
                If another party already submitted the same proof, refresh —
                this redemption will resolve to recovered.
              </p>
            </Callout>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="sm" onClick={onSubmit}>
              Submit default recovery
            </Button>
            <Button variant="ghost" size="sm" onClick={onRefresh}>
              Refresh
            </Button>
          </div>
        </>
      );

    case "submitting":
      return (
        <>
          <Spinner label="Submitting default recovery" />
          <div>
            <Button variant="primary" size="sm" disabled aria-disabled="true">
              Submitting…
            </Button>
          </div>
        </>
      );

    case "submitted":
      return (
        <>
          <Callout tone="info" title="Default submitted">
            <p>
              The default transaction has been submitted and is awaiting
              on-chain confirmation. This panel updates to “Recovered” once the
              AssetManager pays out and the indexer confirms it.
            </p>
            <p className="mt-1 text-xs opacity-80">
              Front-running is harmless: if someone else submitted the same
              valid proof first, refreshing will show the recovered state.
            </p>
          </Callout>
          {txHash !== null ? (
            <DetailRow label="Default tx">
              <TxLink hash={txHash} />
            </DetailRow>
          ) : null}
          <div>
            <Button variant="secondary" size="sm" onClick={onRefresh}>
              Refresh status
            </Button>
          </div>
        </>
      );

    case "recovered":
      return (
        <>
          <Callout tone="success" title="Recovered">
            <p>
              The default has been recovered — the AssetManager released the
              redemption collateral to the redeemer. No further action is
              needed.
            </p>
          </Callout>
          {txHash !== null ? (
            <DetailRow label="Default tx">
              <TxLink hash={txHash} />
            </DetailRow>
          ) : null}
        </>
      );

    default:
      return null;
  }
}

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
