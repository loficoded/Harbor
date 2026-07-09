import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import type { ReactElement } from "react";

export type NetworkGuardViewProps = {
  isConnected: boolean;
  currentChainId: number | undefined;
  expectedChainId: number;
  expectedChainName: string;
  /** Whether the connected wallet supports programmatic chain switching. */
  canSwitch: boolean;
  isSwitching: boolean;
  switchError: string | null;
  onSwitch: () => void;
};

/**
 * Pure presentation of the network guard. Renders nothing when there is no
 * connected wallet or the wallet is already on the expected chain; otherwise it
 * warns and, where the wallet supports it, offers a switch action. Kept prop
 * driven so every state is unit testable without wagmi.
 */
export function NetworkGuardView({
  isConnected,
  currentChainId,
  expectedChainId,
  expectedChainName,
  canSwitch,
  isSwitching,
  switchError,
  onSwitch,
}: NetworkGuardViewProps): ReactElement | null {
  if (!isConnected) {
    return null;
  }

  if (currentChainId === expectedChainId) {
    return null;
  }

  return (
    <Callout
      tone="warning"
      title="Wrong network"
      actions={
        canSwitch ? (
          <Button size="sm" onClick={onSwitch} disabled={isSwitching}>
            {isSwitching ? "Switching…" : `Switch to ${expectedChainName}`}
          </Button>
        ) : undefined
      }
    >
      <p>
        Harbor runs on {expectedChainName} (chain {expectedChainId}).{" "}
        {canSwitch
          ? "Switch networks to continue."
          : `Switch your wallet to ${expectedChainName} to continue.`}
      </p>
      {switchError !== null ? (
        <p className="mt-2 font-medium">
          Could not switch automatically: {switchError}
        </p>
      ) : null}
    </Callout>
  );
}
