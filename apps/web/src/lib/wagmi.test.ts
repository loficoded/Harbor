import { readFrontendEnv } from "@/lib/env";
import { createWagmiConfig, resolveConnectorKinds } from "@/lib/wagmi";
import { describe, expect, it } from "vitest";

describe("resolveConnectorKinds", () => {
  it("uses injected only when WalletConnect is not configured", () => {
    expect(resolveConnectorKinds({ walletConnectConfigured: false })).toEqual([
      "injected",
    ]);
  });

  it("adds walletConnect when configured", () => {
    expect(resolveConnectorKinds({ walletConnectConfigured: true })).toEqual([
      "injected",
      "walletConnect",
    ]);
  });
});

describe("createWagmiConfig", () => {
  it("builds an injected-only config in mock mode", () => {
    const config = createWagmiConfig(readFrontendEnv({}));
    const types = config.connectors.map((connector) => connector.type);

    expect(types).toContain("injected");
    expect(types).not.toContain("walletConnect");
  });

  it("includes walletConnect when a project id is configured", () => {
    const config = createWagmiConfig(
      readFrontendEnv({
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "wc-project-123",
      }),
    );
    const types = config.connectors.map((connector) => connector.type);

    expect(types).toContain("walletConnect");
  });
});
