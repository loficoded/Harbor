import { HARBOR_REDEEMER_ADDRESS, harborRedeemerAbi } from "@harbor/protocol";

export const webHarborProtocolArtifacts = {
  abi: harborRedeemerAbi,
  address: HARBOR_REDEEMER_ADDRESS,
} as const;
