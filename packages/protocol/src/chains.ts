import type { EvmAddress } from "./types.js";

export const coston2Chain = {
  id: 114,
  name: "Flare Testnet Coston2",
  network: "coston2",
  nativeCurrency: {
    name: "Coston2 Flare",
    symbol: "C2FLR",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://coston2-api.flare.network/ext/C/rpc"],
      webSocket: ["wss://coston2-api.flare.network/ext/C/ws"],
    },
  },
  blockExplorers: {
    default: {
      name: "Coston2 Explorer",
      url: "https://coston2-explorer.flare.network",
    },
    systems: {
      name: "Coston2 Systems Explorer",
      url: "https://coston2-systems-explorer.flare.network",
    },
  },
  fdc: {
    dataAvailabilityApi: "https://ctn2-data-availability.flare.network/api-doc",
    xrpVerifierApi:
      "https://fdc-verifiers-testnet.flare.network/verifier/xrp/api-doc",
  },
  flareContractRegistryAddress:
    "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as EvmAddress,
  testnet: true,
} as const;

export type Coston2Chain = typeof coston2Chain;
