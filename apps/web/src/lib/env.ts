import { coston2DefaultRpcUrl } from "@/lib/chain";

/**
 * Frontend configuration resolved from the `NEXT_PUBLIC_*` variables defined in
 * Prompt #03. Every value has a safe local default so the app runs without any
 * configuration ("mock mode"): the API points at the local backend, the RPC
 * falls back to the public Coston2 endpoint, and WalletConnect is simply
 * disabled when its project id is absent.
 */
export type HarborFrontendEnv = Readonly<{
  apiBaseUrl: string;
  rpcUrl: string;
  walletConnectProjectId: string | null;
  contractAddress: string | null;
  /** True only when a WalletConnect project id is configured. */
  walletConnectConfigured: boolean;
}>;

export type RawFrontendEnv = Readonly<Record<string, string | undefined>>;

/**
 * Default backend base URL. Matches the API server's default port from Prompt
 * #15 (`defaultHarborApiPort = 3001`) so local development needs no env setup.
 */
export const DEFAULT_HARBOR_API_BASE_URL = "http://localhost:3001";

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

/**
 * Next.js only inlines `process.env.NEXT_PUBLIC_*` when accessed as a static
 * member expression, so the default source is built with literal accesses here
 * rather than dynamic lookups. Tests pass an explicit source instead.
 */
const defaultSource: RawFrontendEnv = {
  NEXT_PUBLIC_HARBOR_API_URL: process.env.NEXT_PUBLIC_HARBOR_API_URL,
  NEXT_PUBLIC_RPC_URL_COSTON2: process.env.NEXT_PUBLIC_RPC_URL_COSTON2,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  NEXT_PUBLIC_HARBOR_CONTRACT_ADDRESS:
    process.env.NEXT_PUBLIC_HARBOR_CONTRACT_ADDRESS,
};

/**
 * Read and normalize the frontend env. Pure over its `source` argument so the
 * missing-WalletConnect fallback and other defaults are directly testable.
 */
export function readFrontendEnv(
  source: RawFrontendEnv = defaultSource,
): HarborFrontendEnv {
  const walletConnectProjectId = clean(
    source["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"],
  );

  return {
    apiBaseUrl:
      clean(source["NEXT_PUBLIC_HARBOR_API_URL"]) ??
      DEFAULT_HARBOR_API_BASE_URL,
    rpcUrl:
      clean(source["NEXT_PUBLIC_RPC_URL_COSTON2"]) ?? coston2DefaultRpcUrl,
    walletConnectProjectId,
    contractAddress: clean(source["NEXT_PUBLIC_HARBOR_CONTRACT_ADDRESS"]),
    walletConnectConfigured: walletConnectProjectId !== null,
  };
}

let cached: HarborFrontendEnv | null = null;

/** Memoized frontend env for app use. */
export function getClientEnv(): HarborFrontendEnv {
  if (cached === null) {
    cached = readFrontendEnv();
  }

  return cached;
}
