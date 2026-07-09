"use client";

import { harborRedeemerAbi } from "@harbor/protocol";
import { useEffect, useMemo, useRef } from "react";
import { type Abi } from "viem";
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { SelfRecoveryPanelView } from "@/components/status/self-recovery-panel-view";
import { coston2 } from "@/lib/chain";
import type { SelfRecoveryInfo } from "@/lib/redemption-status";
import {
  buildExecuteDefaultArgs,
  EXECUTE_DEFAULT_FUNCTION_NAME,
  resolveHarborRedeemerAddress,
  resolveSelfRecoveryPhase,
  type LocalTxState,
} from "@/lib/self-recovery";

// The protocol ABI is typed with the package's own loose `Abi` shape; cast to
// viem's `Abi` for the wagmi hook. Runtime behavior is unaffected.
const HARBOR_REDEEMER_ABI = harborRedeemerAbi as unknown as Abi;

function firstErrorMessage(
  errors: readonly (Error | null | undefined)[],
): string | null {
  for (const error of errors) {
    if (error) {
      const shortMessage = (error as { shortMessage?: string }).shortMessage;
      return shortMessage ?? error.message;
    }
  }
  return null;
}

/**
 * Permissionless self-recovery transaction container (Prompt #20). Wires live
 * wallet/chain state into the pure {@link SelfRecoveryPanelView} and submits
 * `HarborRedeemer.executeDefault(proof, redemptionRequestId)` — the default
 * path selected in Prompt #04 — using the FDC proof already retrieved by the
 * backend and exposed on `GET /redemptions/:id`.
 *
 * The call is intentionally NOT restricted to the original redeemer: FAssets
 * pays the default collateral to the recorded redeemer regardless of who
 * submits, and Harbor forwards the executor fee to `msg.sender`, so anyone can
 * land it. This removes keeper liveness as a user-facing dependency — the panel
 * takes no keeper-health input and stays actionable whenever a proof exists.
 */
export type SelfRecoveryPanelProps = Readonly<{
  requestId: string;
  selfRecovery: SelfRecoveryInfo;
  /**
   * Configured HarborRedeemer address (NEXT_PUBLIC_HARBOR_CONTRACT_ADDRESS).
   * `null` when unset — the panel then reports the contract as unconfigured
   * rather than attempting a transaction.
   */
  harborRedeemerAddress: string | null;
  /** Refetch the redemption status (used after a confirmed submission). */
  onRecoveryRefresh?: (() => void) | undefined;
}>;

export function SelfRecoveryPanel({
  requestId,
  selfRecovery,
  harborRedeemerAddress,
  onRecoveryRefresh,
}: SelfRecoveryPanelProps) {
  const { address, isConnected, chainId } = useAccount();
  const connected = Boolean(isConnected && address);
  const correctNetwork = chainId === coston2.id;

  const redeemer = resolveHarborRedeemerAddress(harborRedeemerAddress);

  // Build (and validate) the executeDefault calldata from the backend proof.
  // Kept in a memo so the same validated args back both the phase gate and the
  // actual write — the UI never encodes a proof it has not validated.
  const proofResult = useMemo(
    () => buildExecuteDefaultArgs(selfRecovery.proof, requestId),
    [selfRecovery.proof, requestId],
  );

  const defaultTx = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: defaultTx.data });

  const localTx: LocalTxState =
    defaultTx.isPending || (defaultTx.data !== undefined && receipt.isLoading)
      ? "submitting"
      : defaultTx.data !== undefined && receipt.isSuccess
        ? "submitted"
        : "idle";

  const phase = resolveSelfRecoveryPhase({
    visible: selfRecovery.visible,
    recovered: selfRecovery.recovered,
    defaultSubmitted: selfRecovery.defaultSubmitted,
    proofAvailable: selfRecovery.proofAvailable,
    proofValid: proofResult.ok,
    contractConfigured: redeemer !== null,
    walletConnected: connected,
    correctNetwork,
    localTx,
  });

  // Once the default confirms on-chain, refresh the status so the backend/
  // indexer transition to DEFAULT_SUBMITTED/RECOVERED is picked up promptly.
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (receipt.isSuccess && !refreshedRef.current) {
      refreshedRef.current = true;
      onRecoveryRefresh?.();
    }
  }, [receipt.isSuccess, onRecoveryRefresh]);

  function handleSubmit() {
    if (!proofResult.ok || redeemer === null) {
      return;
    }
    defaultTx.writeContract({
      address: redeemer,
      abi: HARBOR_REDEEMER_ABI,
      functionName: EXECUTE_DEFAULT_FUNCTION_NAME,
      args: proofResult.args,
    });
  }

  const errorMessage = firstErrorMessage([defaultTx.error, receipt.error]);

  return (
    <SelfRecoveryPanelView
      phase={phase}
      votingRoundId={selfRecovery.votingRoundId}
      fdcRequestStatus={selfRecovery.fdcRequestStatus}
      defaultTransactionHash={selfRecovery.defaultTransactionHash}
      submittedTransactionHash={defaultTx.data ?? null}
      errorMessage={errorMessage}
      onSubmit={handleSubmit}
      onRefresh={() => onRecoveryRefresh?.()}
    />
  );
}
