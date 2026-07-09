import { coston2Chain } from "@harbor/protocol";
import { defineChain } from "viem";

/**
 * viem `Chain` for Flare Testnet Coston2, derived from the single source of
 * truth in `@harbor/protocol`. The protocol package carries a richer descriptor
 * (FDC endpoints, registry address); here we project just the fields viem and
 * wagmi need so the wallet stack has a clean, standard chain definition.
 */
export const coston2 = defineChain({
  id: coston2Chain.id,
  name: coston2Chain.name,
  nativeCurrency: coston2Chain.nativeCurrency,
  rpcUrls: {
    default: {
      http: [coston2Chain.rpcUrls.default.http[0]],
      webSocket: [coston2Chain.rpcUrls.default.webSocket[0]],
    },
  },
  blockExplorers: {
    default: {
      name: coston2Chain.blockExplorers.default.name,
      url: coston2Chain.blockExplorers.default.url,
    },
  },
  testnet: coston2Chain.testnet,
});

/** Numeric chain id (114) the app expects the connected wallet to be on. */
export const coston2ChainId = coston2.id;

/** Default public RPC endpoint, used when no override env var is provided. */
export const coston2DefaultRpcUrl = coston2Chain.rpcUrls.default.http[0];

/** Base URL of the Coston2 block explorer for linking out to transactions. */
export const coston2ExplorerUrl = coston2Chain.blockExplorers.default.url;

/** Build an explorer URL for a transaction hash on Coston2. */
export function coston2TransactionUrl(transactionHash: string): string {
  return `${coston2ExplorerUrl}/tx/${transactionHash}`;
}

/** Build an explorer URL for an address on Coston2. */
export function coston2AddressUrl(address: string): string {
  return `${coston2ExplorerUrl}/address/${address}`;
}
