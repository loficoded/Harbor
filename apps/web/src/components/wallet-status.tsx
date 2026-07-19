"use client";

import { Button } from "@/components/ui/button";
import { formatAddress } from "@/lib/format";
import { useAccount, useConnect, useDisconnect } from "wagmi";

/**
 * Harness mode renders a static, deterministic wallet chip so screenshots can
 * show a "connected" wallet without a live wagmi session. Enabled by setting
 * `NEXT_PUBLIC_HARBOR_HARNESS=1` at build time.
 */
const HARNESS_MODE = process.env.NEXT_PUBLIC_HARBOR_HARNESS === "1";
const HARNESS_WALLET_ADDRESS = "0x7C2a48B93D5e6A1F2C3B4D5e6F7A8B9C0D1E2F3A";

/**
 * Wallet connect/disconnect control. Renders one connect action per configured
 * connector (injected always present; WalletConnect only when configured) and,
 * once connected, the truncated address with a disconnect action.
 */
export function WalletStatus() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (HARNESS_MODE) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-gray-200 px-2.5 py-1 font-mono text-xs text-gray-700 dark:border-gray-700 dark:text-gray-300">
          {formatAddress(HARNESS_WALLET_ADDRESS)}
        </span>
        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
          Harness
        </span>
      </div>
    );
  }

  if (isConnected && address !== undefined) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-gray-200 px-2.5 py-1 font-mono text-xs text-gray-700 dark:border-gray-700 dark:text-gray-300">
          {formatAddress(address)}
        </span>
        <Button variant="secondary" size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  if (connectors.length === 0) {
    return (
      <span className="text-sm text-gray-500 dark:text-gray-400">
        No wallet connectors
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {connectors.map((connector, index) => (
        <Button
          key={connector.uid}
          size="sm"
          variant={index === 0 ? "primary" : "secondary"}
          disabled={isPending}
          onClick={() => connect({ connector })}
        >
          {isPending ? "Connecting…" : `Connect ${connector.name}`}
        </Button>
      ))}
    </div>
  );
}
