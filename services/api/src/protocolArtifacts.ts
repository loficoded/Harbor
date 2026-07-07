import { HARBOR_REDEEMER_ADDRESS, harborRedeemerAbi } from "@harbor/protocol";

export const apiHarborProtocolArtifacts = {
  abi: harborRedeemerAbi,
  address: HARBOR_REDEEMER_ADDRESS,
} as const;
