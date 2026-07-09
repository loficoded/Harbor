"use client";

import { NetworkGuardView } from "@/components/network-guard-view";
import { coston2 } from "@/lib/chain";
import type { ReactElement } from "react";
import { useAccount, useSwitchChain } from "wagmi";

/**
 * Container that wires live wallet state into {@link NetworkGuardView}. Switch
 * capability is read from the active connector so the switch action is only
 * offered when the wallet actually supports it.
 */
export function NetworkGuard(): ReactElement | null {
  const { isConnected, chainId, connector } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();

  const canSwitch = Boolean(connector?.switchChain);

  return (
    <NetworkGuardView
      isConnected={isConnected}
      currentChainId={chainId}
      expectedChainId={coston2.id}
      expectedChainName={coston2.name}
      canSwitch={canSwitch}
      isSwitching={isPending}
      switchError={error !== null ? error.message : null}
      onSwitch={() => switchChain({ chainId: coston2.id })}
    />
  );
}
