import { harborRedeemerAbi } from "./abis.js";
import { harborRedeemerAddress } from "./addresses.js";

export const harborContractPlaceholders = {
  redeemer: {
    address: harborRedeemerAddress,
    abi: harborRedeemerAbi,
  },
} as const;
