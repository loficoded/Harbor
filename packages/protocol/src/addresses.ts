import { coston2Chain } from "./chains.js";
import type { EvmAddress } from "./types.js";

export const coston2RegistryNames = {
  assetManagerFXRP: "AssetManagerFXRP",
  fdcHub: "FdcHub",
  fdcVerification: "FdcVerification",
  relay: "Relay",
  ftsoV2: "FtsoV2",
} as const;

export const coston2ProtocolAddresses = {
  flareContractRegistry: coston2Chain.flareContractRegistryAddress,
  fxrpAssetManager: "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA",
  fAssetToken: "0x0b6A3645c240605887a5532109323A3E12273dc7",
  fdcHub: "0x48aC463d7975828989331F4De43341627b9c5f1D",
  fdcVerification: "0x906507E0B64bcD494Db73bd0459d1C667e14B933",
  relay: "0xa10B672D1c62e5457b17af63d4302add6A99d7dE",
  ftsoV2: "0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d",
} as const satisfies Record<string, EvmAddress>;

export const coston2FxrpAssetManagerAddress =
  coston2ProtocolAddresses.fxrpAssetManager;
export const coston2FAssetTokenAddress = coston2ProtocolAddresses.fAssetToken;
export const coston2FdcHubAddress = coston2ProtocolAddresses.fdcHub;
export const coston2FdcVerificationAddress =
  coston2ProtocolAddresses.fdcVerification;
export const coston2RelayAddress = coston2ProtocolAddresses.relay;
export const coston2FtsoV2Address = coston2ProtocolAddresses.ftsoV2;

export const coston2FxrpAsset = {
  assetManagerAddress: coston2FxrpAssetManagerAddress,
  fAssetTokenAddress: coston2FAssetTokenAddress,
  assetManagerRegistryName: coston2RegistryNames.assetManagerFXRP,
  name: "FXRP",
  symbol: "FTestXRP",
  decimals: 6,
  lotSizeUBA: 10_000_000n,
} as const;

export const coston2VerifiedAddressSnapshot = {
  verifiedOn: "2026-07-07",
  rpcUrl: coston2Chain.rpcUrls.default.http[0],
  method:
    "FlareContractRegistry.getContractAddressByName plus AssetManager.fAsset()",
  registryAddress: coston2ProtocolAddresses.flareContractRegistry,
} as const;

export const harborRedeemerAddress: EvmAddress | undefined = undefined;
