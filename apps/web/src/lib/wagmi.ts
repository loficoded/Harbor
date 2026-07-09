import { coston2 } from "@/lib/chain";
import { getClientEnv, type HarborFrontendEnv } from "@/lib/env";
import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";

export type WalletConnectorKind = "injected" | "walletConnect";

/**
 * Which wallet connectors the app wires up for a given configuration. The
 * WalletConnect connector is only added when a project id is present; without
 * it the app still works with injected browser wallets ("mock mode").
 */
export function resolveConnectorKinds(
  env: Pick<HarborFrontendEnv, "walletConnectConfigured">,
): WalletConnectorKind[] {
  const kinds: WalletConnectorKind[] = ["injected"];

  if (env.walletConnectConfigured) {
    kinds.push("walletConnect");
  }

  return kinds;
}

/**
 * Build a wagmi config for Coston2 from resolved frontend env. WalletConnect is
 * added only when configured, so a missing project id degrades to injected-only
 * rather than throwing.
 */
export function createWagmiConfig(env: HarborFrontendEnv) {
  const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];

  if (env.walletConnectConfigured && env.walletConnectProjectId !== null) {
    connectors.push(
      walletConnect({
        projectId: env.walletConnectProjectId,
        showQrModal: true,
      }),
    );
  }

  return createConfig({
    chains: [coston2],
    connectors,
    transports: {
      [coston2.id]: http(env.rpcUrl),
    },
    ssr: true,
  });
}

type HarborWagmiConfig = ReturnType<typeof createWagmiConfig>;

// Register the config type so wagmi hooks are narrowed to the Coston2 chain.
declare module "wagmi" {
  interface Register {
    config: HarborWagmiConfig;
  }
}

let cached: HarborWagmiConfig | null = null;

/** Stable, lazily-created wagmi config singleton for the running app. */
export function getWagmiConfig(): HarborWagmiConfig {
  if (cached === null) {
    cached = createWagmiConfig(getClientEnv());
  }

  return cached;
}
