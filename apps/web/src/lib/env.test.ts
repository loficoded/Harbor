import { coston2DefaultRpcUrl } from "@/lib/chain";
import { DEFAULT_HARBOR_API_BASE_URL, readFrontendEnv } from "@/lib/env";
import { describe, expect, it } from "vitest";

describe("readFrontendEnv", () => {
  it("falls back to mock-mode defaults when nothing is configured", () => {
    const env = readFrontendEnv({});

    expect(env.apiBaseUrl).toBe(DEFAULT_HARBOR_API_BASE_URL);
    expect(env.rpcUrl).toBe(coston2DefaultRpcUrl);
    expect(env.walletConnectProjectId).toBeNull();
    expect(env.walletConnectConfigured).toBe(false);
    expect(env.contractAddress).toBeNull();
  });

  it("treats a blank WalletConnect id as not configured", () => {
    const env = readFrontendEnv({
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "   ",
    });

    expect(env.walletConnectConfigured).toBe(false);
    expect(env.walletConnectProjectId).toBeNull();
  });

  it("marks WalletConnect configured when a project id is present", () => {
    const env = readFrontendEnv({
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "wc-project-123",
    });

    expect(env.walletConnectConfigured).toBe(true);
    expect(env.walletConnectProjectId).toBe("wc-project-123");
  });

  it("uses configured API, RPC, and contract values when provided", () => {
    const env = readFrontendEnv({
      NEXT_PUBLIC_HARBOR_API_URL: "https://api.harbor.example",
      NEXT_PUBLIC_RPC_URL_COSTON2: "https://rpc.example/ext/C/rpc",
      NEXT_PUBLIC_HARBOR_CONTRACT_ADDRESS:
        "0x00000000000000000000000000000000000000ab",
    });

    expect(env.apiBaseUrl).toBe("https://api.harbor.example");
    expect(env.rpcUrl).toBe("https://rpc.example/ext/C/rpc");
    expect(env.contractAddress).toBe(
      "0x00000000000000000000000000000000000000ab",
    );
  });
});
