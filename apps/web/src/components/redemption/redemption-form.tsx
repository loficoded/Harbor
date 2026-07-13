"use client";

import { RedemptionFormView } from "@/components/redemption/redemption-form-view";
import { coston2 } from "@/lib/chain";
import { getClientEnv } from "@/lib/env";
import { formatAddress } from "@/lib/format";
import {
  buildStatusPath,
  DEFAULT_FXRP_LOT_SIZE_UBA,
  DEFAULT_REDEEM_MODE,
  formatFxrpAmount,
  FXRP_ASSET_MANAGER_ADDRESS,
  FXRP_TOKEN_ADDRESS,
  hasSufficientBalance,
  isApprovalRequired,
  lotsToUba,
  parseLotCount,
  parseRedeemAmount,
  parseRedemptionRequestIds,
  redemptionBlockedReason,
  resolveExecutor,
  type RedeemMode,
  type RedemptionLogInput,
} from "@/lib/redemption";
import { validateXrplDestination } from "@/lib/xrpl";
import { iAssetManagerAbi, iFAssetAbi } from "@harbor/protocol";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatEther, type Abi } from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

// The protocol ABIs are typed with the package's own loose `Abi` shape; cast to
// viem's `Abi` for the wagmi hooks. Runtime behavior is unaffected; reads are
// narrowed defensively below.
const F_ASSET_ABI = iFAssetAbi as unknown as Abi;
const ASSET_MANAGER_ABI = iAssetManagerAbi as unknown as Abi;

function firstErrorMessage(
  errors: readonly (Error | null | undefined)[],
): string | null {
  for (const error of errors) {
    if (error) {
      // wagmi/viem errors carry a concise `shortMessage`; prefer it.
      const shortMessage = (error as { shortMessage?: string }).shortMessage;
      return shortMessage ?? error.message;
    }
  }
  return null;
}

/**
 * Redemption flow container. Wires live wallet/chain/contract state into the
 * pure {@link RedemptionFormView}.
 *
 * Contract path (Prompt #04): a direct `AssetManager` redeem from the user's
 * wallet after approving the AssetManager for the exact amount. Arbitrary FXRP
 * amounts (the primary flow) use `redeemAmount(amountUBA, xrplAddress,
 * executor)`; the optional whole-lot mode uses `redeem(lots, …)`. In both cases
 * the FAssets protocol assigns the redemption agent(s) FIFO — Harbor sends no
 * agent selection. The executor is the configured Harbor keeper (or the zero
 * address when unconfigured), keeping default recovery permissionless via
 * Harbor. On a confirmed receipt the emitted `RedemptionRequested` ids are
 * parsed and the app routes to the status page for the first id.
 */
export function RedemptionForm() {
  const router = useRouter();
  const env = getClientEnv();
  const { address, isConnected, chainId } = useAccount();
  const connected = Boolean(isConnected && address);
  const correctNetwork = chainId === coston2.id;

  const [mode, setMode] = useState<RedeemMode>(DEFAULT_REDEEM_MODE);
  const [amountInput, setAmountInput] = useState("");
  const [lotInput, setLotInput] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [submittedIds, setSubmittedIds] = useState<readonly string[] | null>(
    null,
  );

  const { amountUba, error: amountError } = parseRedeemAmount(amountInput);
  const { lots, error: lotError } = parseLotCount(lotInput);
  const addressValidation = validateXrplDestination(addressInput);

  const lotSizeUba = DEFAULT_FXRP_LOT_SIZE_UBA;

  // Resolve the amount to redeem (UBA) and the active input's validation state
  // from the current mode. `requiredUba` is 0n whenever the input is empty or
  // invalid so approval/balance gating stays inert until a real amount exists.
  const inputProvided = mode === "amount" ? amountUba !== null : lots !== null;
  const inputError = mode === "amount" ? amountError : lotError;
  const requiredUba =
    mode === "amount"
      ? (amountUba ?? 0n)
      : lots !== null
        ? lotsToUba(lots, lotSizeUba)
        : 0n;
  const amountLabel = requiredUba > 0n ? formatFxrpAmount(requiredUba) : null;

  const executor = resolveExecutor(env.contractAddress, env.executorFeeWei);

  const balanceRead = useReadContract({
    address: FXRP_TOKEN_ADDRESS,
    abi: F_ASSET_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: connected },
  });
  const balance =
    typeof balanceRead.data === "bigint" ? balanceRead.data : undefined;
  const balanceLabel = balance !== undefined ? formatFxrpAmount(balance) : null;

  const allowanceRead = useReadContract({
    address: FXRP_TOKEN_ADDRESS,
    abi: F_ASSET_ABI,
    functionName: "allowance",
    args: address ? [address, FXRP_ASSET_MANAGER_ADDRESS] : undefined,
    query: { enabled: connected },
  });
  const allowance =
    typeof allowanceRead.data === "bigint" ? allowanceRead.data : undefined;

  const approvalRequired = isApprovalRequired(allowance, requiredUba);
  const sufficientBalance = hasSufficientBalance(balance, requiredUba);

  const approveTx = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({ hash: approveTx.data });
  const redeemTx = useWriteContract();
  const redeemReceipt = useWaitForTransactionReceipt({ hash: redeemTx.data });

  const approvalPending =
    approveTx.isPending ||
    (approveTx.data !== undefined && approveReceipt.isLoading);
  const redeemPending =
    redeemTx.isPending ||
    (redeemTx.data !== undefined && redeemReceipt.isLoading);

  // Refresh allowance once approval confirms so the redeem step unlocks.
  const refetchedRef = useRef(false);
  useEffect(() => {
    if (approveReceipt.isSuccess && !refetchedRef.current) {
      refetchedRef.current = true;
      void allowanceRead.refetch();
    }
  }, [approveReceipt.isSuccess, allowanceRead]);

  // On a confirmed redeem, parse request ids and route to the status page. No
  // agent is carried in the route — the protocol assigns agents FIFO and the
  // status page reads the assigned agent(s) from indexed protocol data.
  const navigatedRef = useRef(false);
  useEffect(() => {
    if (
      !redeemReceipt.isSuccess ||
      redeemReceipt.data === undefined ||
      navigatedRef.current
    ) {
      return;
    }
    navigatedRef.current = true;

    const logs = (redeemReceipt.data.logs ??
      []) as unknown as RedemptionLogInput[];
    const ids = parseRedemptionRequestIds(logs);
    setSubmittedIds(ids);

    const path = buildStatusPath({
      requestIds: ids,
      transactionHash: redeemReceipt.data.transactionHash,
    });
    if (path !== null) {
      router.push(path);
    }
  }, [redeemReceipt.isSuccess, redeemReceipt.data, router]);

  const blockedReason = redemptionBlockedReason({
    isConnected: connected,
    correctNetwork,
    requiredUba: inputProvided ? requiredUba : null,
    inputError,
    addressValid: addressValidation.valid,
    balanceKnown: balance !== undefined,
    sufficientBalance,
  });

  const errorMessage = firstErrorMessage([
    approveTx.error,
    approveReceipt.error,
    redeemTx.error,
    redeemReceipt.error,
  ]);

  function resetSubmission() {
    setSubmittedIds(null);
  }

  function handleModeChange(next: RedeemMode) {
    setMode(next);
    resetSubmission();
  }

  function handleApprove() {
    if (blockedReason !== null || requiredUba <= 0n) {
      return;
    }
    approveTx.writeContract({
      address: FXRP_TOKEN_ADDRESS,
      abi: F_ASSET_ABI,
      functionName: "approve",
      args: [FXRP_ASSET_MANAGER_ADDRESS, requiredUba],
    });
  }

  function handleRedeem() {
    if (
      blockedReason !== null ||
      approvalRequired ||
      addressValidation.address === null
    ) {
      return;
    }

    // Arbitrary amount (primary): redeemAmount(amountUBA, xrplAddress, executor).
    if (mode === "amount") {
      if (amountUba === null) {
        return;
      }
      redeemTx.writeContract({
        address: FXRP_ASSET_MANAGER_ADDRESS,
        abi: ASSET_MANAGER_ABI,
        functionName: "redeemAmount",
        args: [amountUba, addressValidation.address, executor.executor],
        value: executor.executorFeeWei,
      });
      return;
    }

    // Whole lots (advanced): redeem(lots, xrplAddress, executor).
    if (lots === null) {
      return;
    }
    redeemTx.writeContract({
      address: FXRP_ASSET_MANAGER_ADDRESS,
      abi: ASSET_MANAGER_ABI,
      functionName: "redeem",
      args: [lots, addressValidation.address, executor.executor],
      value: executor.executorFeeWei,
    });
  }

  const executorFeeLabel = `${formatEther(executor.executorFeeWei)} ${
    coston2.nativeCurrency.symbol
  }`;
  const executorLabel = executor.harborManaged
    ? formatAddress(executor.executor)
    : "None (self-managed)";

  return (
    <RedemptionFormView
      isConnected={connected}
      correctNetwork={correctNetwork}
      balanceLabel={balanceLabel}
      balanceLoading={balanceRead.isLoading && connected}
      mode={mode}
      onModeChange={handleModeChange}
      amountInput={amountInput}
      onAmountInputChange={(value) => {
        setAmountInput(value);
        resetSubmission();
      }}
      amountError={amountError}
      lotInput={lotInput}
      onLotInputChange={(value) => {
        setLotInput(value);
        resetSubmission();
      }}
      lotError={lotError}
      amountLabel={amountLabel}
      addressInput={addressInput}
      onAddressChange={(value) => {
        setAddressInput(value);
        resetSubmission();
      }}
      addressError={addressValidation.reason}
      executorFeeLabel={executorFeeLabel}
      executorLabel={executorLabel}
      harborManaged={executor.harborManaged}
      approvalRequired={approvalRequired}
      approvalPending={approvalPending}
      redeemPending={redeemPending}
      blockedReason={blockedReason}
      errorMessage={errorMessage}
      submittedRequestIds={submittedIds}
      onApprove={handleApprove}
      onRedeem={handleRedeem}
    />
  );
}
