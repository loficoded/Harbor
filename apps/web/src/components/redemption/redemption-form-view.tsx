import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Spinner } from "@/components/ui/spinner";
import { FXRP_DECIMALS, FXRP_LABEL } from "@/lib/redemption";
import type { ReactElement } from "react";

export type RedemptionFormViewProps = {
  // Wallet / network
  isConnected: boolean;
  correctNetwork: boolean;

  // FXRP balance
  balanceLabel: string | null;
  balanceLoading: boolean;

  // Arbitrary FXRP amount to redeem
  amountInput: string;
  onAmountInputChange: (value: string) => void;
  amountError: string | null;

  // Computed amount (formatted FXRP) for the current input, or null when empty
  amountLabel: string | null;

  // XRPL destination
  addressInput: string;
  onAddressChange: (value: string) => void;
  addressError: string | null;

  // Executor
  executorFeeLabel: string;
  executorLabel: string;
  harborManaged: boolean;

  // Approval / redeem
  approvalRequired: boolean;
  approvalPending: boolean;
  redeemPending: boolean;
  /** Non-null disables the primary actions and explains why. */
  blockedReason: string | null;
  errorMessage: string | null;
  /** Request ids parsed from a confirmed redeem receipt; null until success. */
  submittedRequestIds: readonly string[] | null;

  onApprove: () => void;
  onRedeem: () => void;
};

function fieldLabelClass(): string {
  return "text-xs font-medium text-gray-600 dark:text-gray-400";
}

function inputClass(): string {
  return (
    "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm " +
    "text-gray-900 placeholder:text-gray-400 focus-visible:outline-none " +
    "focus-visible:ring-2 focus-visible:ring-accent/60 dark:border-gray-700 " +
    "dark:bg-gray-950 dark:text-gray-100"
  );
}

/**
 * Pure, prop-driven redemption form. All wallet, chain, balance, allowance, and
 * transaction state arrives as props so every state — disconnected, wrong
 * network, approval required vs approved, pending, success, failure — is unit
 * testable without wagmi. The container wires live state into these props.
 *
 * The form has no agent-selection control by design: the FAssets protocol
 * assigns redemption agents automatically, FIFO. The user only supplies an
 * arbitrary FXRP amount and an XRPL destination.
 */
export function RedemptionFormView(
  props: RedemptionFormViewProps,
): ReactElement {
  const {
    isConnected,
    correctNetwork,
    balanceLabel,
    balanceLoading,
    amountInput,
    onAmountInputChange,
    amountError,
    amountLabel,
    addressInput,
    onAddressChange,
    addressError,
    executorFeeLabel,
    executorLabel,
    harborManaged,
    approvalRequired,
    approvalPending,
    redeemPending,
    blockedReason,
    errorMessage,
    submittedRequestIds,
    onApprove,
    onRedeem,
  } = props;

  const busy = approvalPending || redeemPending;
  const approveDisabled = blockedReason !== null || busy;
  const redeemDisabled = blockedReason !== null || approvalRequired || busy;

  return (
    <div className="flex flex-col gap-5">
      {/* FIFO / no-agent-selection notice */}
      <Callout tone="info" title="Agents are assigned automatically (FIFO)">
        <p>
          Agent selection is handled automatically by the FAssets protocol using
          FIFO. Submit a redemption amount and XRPL destination — the protocol
          assigns the redemption ticket(s) and Harbor monitors whichever
          agent(s) it assigns. You do not choose a specific agent.
        </p>
      </Callout>

      {/* Balance */}
      <div className="flex items-center justify-between gap-4 rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
        <span className={fieldLabelClass()}>{FXRP_LABEL} balance</span>
        <span className="font-mono text-sm text-gray-900 dark:text-gray-100">
          {!isConnected ? (
            <span className="text-gray-400">Connect wallet</span>
          ) : balanceLoading ? (
            <Spinner label="Loading…" />
          ) : balanceLabel !== null ? (
            `${balanceLabel} ${FXRP_LABEL}`
          ) : (
            "—"
          )}
        </span>
      </div>

      {/* Amount to redeem */}
      <div className="flex flex-col gap-2">
        <label htmlFor="redeem-amount" className={fieldLabelClass()}>
          Amount ({FXRP_LABEL})
        </label>
        <input
          id="redeem-amount"
          type="text"
          inputMode="decimal"
          value={amountInput}
          onChange={(event) => onAmountInputChange(event.target.value)}
          placeholder="e.g. 2.37"
          aria-label={`Amount (${FXRP_LABEL})`}
          aria-invalid={amountError !== null}
          className={inputClass()}
        />
        {amountError !== null ? (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">
            {amountError}
          </p>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            FAssets supports redeeming any amount — enter a whole or decimal{" "}
            {FXRP_LABEL} amount (up to {FXRP_DECIMALS} decimals).
            {amountLabel !== null
              ? ` Redeems ${amountLabel} ${FXRP_LABEL}.`
              : ""}
          </p>
        )}
      </div>

      {/* XRPL destination */}
      <div className="flex flex-col gap-2">
        <label htmlFor="xrpl-address" className={fieldLabelClass()}>
          XRPL destination address
        </label>
        <input
          id="xrpl-address"
          type="text"
          value={addressInput}
          onChange={(event) => onAddressChange(event.target.value)}
          placeholder="r…"
          aria-label="XRPL destination address"
          aria-invalid={addressError !== null}
          spellCheck={false}
          className={`${inputClass()} font-mono`}
        />
        {addressError !== null ? (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">
            {addressError}
          </p>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            The XRP address that will receive the redeemed underlying XRP.
          </p>
        )}
      </div>

      {/* Executor fee */}
      <div className="flex flex-col gap-1 rounded-md border border-gray-200 px-3 py-2 text-xs dark:border-gray-800">
        <div className="flex items-center justify-between gap-4">
          <span className={fieldLabelClass()}>Executor fee</span>
          <span className="font-mono text-gray-900 dark:text-gray-100">
            {executorFeeLabel}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className={fieldLabelClass()}>Executor</span>
          <span className="font-mono text-gray-500 dark:text-gray-400">
            {executorLabel}
          </span>
        </div>
        <p className="mt-1 text-gray-500 dark:text-gray-400">
          {harborManaged
            ? "Paid to the Harbor keeper if it triggers default recovery."
            : "No executor configured — this redemption is self-managed."}
        </p>
      </div>

      {/* Status: success / error / pending */}
      {submittedRequestIds !== null ? (
        <Callout tone="success" title="Redemption request submitted">
          <p>
            {submittedRequestIds.length === 1 ? "Request id " : "Request ids "}
            <span className="font-mono">{submittedRequestIds.join(", ")}</span>.
            Opening status to track settlement — recovery is not complete until
            the backend confirms it.
          </p>
        </Callout>
      ) : errorMessage !== null ? (
        <Callout tone="danger" title="Transaction failed">
          <p>{errorMessage}</p>
        </Callout>
      ) : busy ? (
        <Callout
          tone="info"
          title={approvalPending ? "Approving FXRP" : "Submitting redemption"}
        >
          <p>Waiting for wallet confirmation and on-chain inclusion…</p>
        </Callout>
      ) : null}

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          {approvalRequired ? (
            <Button
              type="button"
              onClick={onApprove}
              disabled={approveDisabled}
              className="sm:flex-1"
            >
              {approvalPending ? "Approving…" : `Approve ${FXRP_LABEL}`}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={approvalRequired ? "secondary" : "primary"}
            onClick={onRedeem}
            disabled={redeemDisabled}
            className="sm:flex-1"
          >
            {redeemPending ? "Submitting…" : "Redeem"}
          </Button>
        </div>
        {blockedReason !== null ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {blockedReason}
          </p>
        ) : approvalRequired ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Approve the AssetManager to spend the exact redemption amount, then
            redeem.
          </p>
        ) : null}
        {isConnected && !correctNetwork ? (
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            Wrong network — switch to Coston2 to continue.
          </p>
        ) : null}
      </div>
    </div>
  );
}
