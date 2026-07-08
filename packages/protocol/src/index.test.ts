import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assetManagerAbi,
  assetManagerEventsAbi,
  coston2Chain,
  coston2FAssetTokenAddress,
  coston2FdcHubAddress,
  coston2FdcVerificationAddress,
  coston2FtsoV2Address,
  coston2FxrpAsset,
  coston2FxrpAssetManagerAddress,
  coston2ProtocolAddresses,
  coston2RegistryNames,
  coston2RelayAddress,
  coston2VerifiedAddressSnapshot,
  fAssetAbi,
  fdcHubAbi,
  flareContractRegistryAbi,
  ftsoV2Abi,
  ftsoV2InterfaceAbi,
  harborContractAbi,
  harborContractPlaceholders,
  harborRedeemerAbi,
  harborRedeemerAddress,
  iAssetManagerAbi,
  iAssetManagerEventsAbi,
  iFAssetAbi,
  iFdcHubAbi,
  iFlareContractRegistryAbi,
  iRelayAbi,
  relayAbi,
  type Abi,
  type AbiFragment,
  type EvmAddress,
} from "./index.js";

type NamedFragment = Extract<
  AbiFragment,
  { readonly type: "function" | "event" }
> & {
  readonly inputs: readonly unknown[];
  readonly name: string;
  readonly type: "function" | "event";
};

const findFragment = (
  abi: Abi,
  type: "function" | "event",
  name: string,
): NamedFragment => {
  const fragment = abi.find(
    (item): item is NamedFragment =>
      item.type === type && "name" in item && item.name === name,
  );
  assert.ok(fragment, `${type} ${name} is exported`);
  return fragment;
};

const expectInputCount = (
  abi: Abi,
  type: "function" | "event",
  name: string,
  count: number,
): void => {
  assert.equal(findFragment(abi, type, name).inputs.length, count);
};

const expectValidEvmAddress = (address: EvmAddress): void => {
  assert.match(address, /^0x[a-fA-F0-9]{40}$/);
};

describe("Coston2 protocol registry exports", () => {
  test("exports every chain and address constant used by downstream packages", () => {
    assert.equal(coston2Chain.id, 114);
    assert.equal(coston2Chain.nativeCurrency.symbol, "C2FLR");
    assert.equal(coston2RegistryNames.assetManagerFXRP, "AssetManagerFXRP");
    assert.equal(coston2FxrpAsset.name, "FXRP");
    assert.equal(coston2FxrpAsset.symbol, "FTestXRP");
    assert.equal(coston2FxrpAsset.decimals, 6);
    assert.equal(coston2FxrpAsset.lotSizeUBA, 10_000_000n);
    assert.equal(coston2VerifiedAddressSnapshot.verifiedOn, "2026-07-07");

    assert.equal(
      coston2FxrpAssetManagerAddress,
      coston2ProtocolAddresses.fxrpAssetManager,
    );
    assert.equal(
      coston2FAssetTokenAddress,
      coston2ProtocolAddresses.fAssetToken,
    );
    assert.equal(coston2FdcHubAddress, coston2ProtocolAddresses.fdcHub);
    assert.equal(
      coston2FdcVerificationAddress,
      coston2ProtocolAddresses.fdcVerification,
    );
    assert.equal(coston2RelayAddress, coston2ProtocolAddresses.relay);
    assert.equal(coston2FtsoV2Address, coston2ProtocolAddresses.ftsoV2);
    assert.equal(harborRedeemerAddress, undefined);
  });

  test("all known Coston2 EVM addresses are valid", () => {
    for (const address of Object.values(coston2ProtocolAddresses)) {
      expectValidEvmAddress(address);
    }
  });
});

describe("ABI exports", () => {
  test("exports the AssetManager functions Harbor needs", () => {
    expectInputCount(assetManagerAbi, "function", "fAsset", 0);
    expectInputCount(assetManagerAbi, "function", "getSettings", 0);
    expectInputCount(assetManagerAbi, "function", "getAllAgents", 2);
    expectInputCount(assetManagerAbi, "function", "getAvailableAgentsList", 2);
    expectInputCount(
      assetManagerAbi,
      "function",
      "getAvailableAgentsDetailedList",
      2,
    );
    expectInputCount(assetManagerAbi, "function", "getAgentInfo", 1);
    expectInputCount(assetManagerAbi, "function", "getAgentSetting", 2);
    expectInputCount(assetManagerAbi, "function", "getAgentVaultOwner", 1);
    expectInputCount(
      assetManagerAbi,
      "function",
      "getAgentVaultCollateralToken",
      1,
    );
    expectInputCount(
      assetManagerAbi,
      "function",
      "getAgentFullVaultCollateral",
      1,
    );
    expectInputCount(
      assetManagerAbi,
      "function",
      "getAgentFullPoolCollateral",
      1,
    );
    expectInputCount(assetManagerAbi, "function", "redeem", 3);
    expectInputCount(assetManagerAbi, "function", "redeemAmount", 3);
    expectInputCount(
      assetManagerAbi,
      "function",
      "redemptionPaymentDefault",
      2,
    );
  });

  test("exports the AssetManager event fragments used by the indexer", () => {
    expectInputCount(assetManagerEventsAbi, "event", "RedemptionRequested", 12);
    expectInputCount(
      assetManagerEventsAbi,
      "event",
      "RedemptionWithTagRequested",
      13,
    );
    expectInputCount(assetManagerEventsAbi, "event", "RedemptionPerformed", 6);
    expectInputCount(assetManagerEventsAbi, "event", "RedemptionDefault", 6);
    expectInputCount(
      assetManagerEventsAbi,
      "event",
      "RedemptionPaymentBlocked",
      6,
    );
    expectInputCount(
      assetManagerEventsAbi,
      "event",
      "RedemptionPaymentFailed",
      6,
    );
    expectInputCount(
      assetManagerEventsAbi,
      "event",
      "RedemptionRequestIncomplete",
      2,
    );
    expectInputCount(assetManagerEventsAbi, "event", "RedemptionRejected", 4);
    expectInputCount(
      assetManagerEventsAbi,
      "event",
      "RedemptionTicketCreated",
      3,
    );
    expectInputCount(
      assetManagerEventsAbi,
      "event",
      "RedemptionTicketUpdated",
      3,
    );
    expectInputCount(
      assetManagerEventsAbi,
      "event",
      "RedemptionTicketDeleted",
      2,
    );
  });

  test("exports FAsset ERC-20 fragments for approvals and balances", () => {
    expectInputCount(fAssetAbi, "function", "allowance", 2);
    expectInputCount(fAssetAbi, "function", "approve", 2);
    expectInputCount(fAssetAbi, "function", "balanceOf", 1);
    expectInputCount(fAssetAbi, "function", "decimals", 0);
    expectInputCount(fAssetAbi, "function", "name", 0);
    expectInputCount(fAssetAbi, "function", "symbol", 0);
    expectInputCount(fAssetAbi, "event", "Approval", 3);
    expectInputCount(fAssetAbi, "event", "Transfer", 3);
  });

  test("exports FDC, FTSO, Relay, registry, and Harbor placeholder ABIs", () => {
    expectInputCount(fdcHubAbi, "function", "requestAttestation", 1);
    expectInputCount(fdcHubAbi, "function", "requestsOffsetSeconds", 0);
    expectInputCount(fdcHubAbi, "event", "AttestationRequest", 2);

    expectInputCount(ftsoV2Abi, "function", "getFeedById", 1);
    expectInputCount(ftsoV2Abi, "function", "getFeedsById", 1);
    expectInputCount(ftsoV2Abi, "function", "calculateFeeById", 1);
    expectInputCount(ftsoV2Abi, "function", "calculateFeeByIds", 1);
    expectInputCount(ftsoV2Abi, "function", "getFtsoProtocolId", 0);

    expectInputCount(relayAbi, "function", "isFinalized", 2);
    expectInputCount(relayAbi, "function", "merkleRoots", 2);
    expectInputCount(relayAbi, "function", "getVotingRoundId", 1);
    expectInputCount(relayAbi, "function", "protocolFeeInWei", 1);
    expectInputCount(relayAbi, "event", "ProtocolMessageRelayed", 4);

    expectInputCount(
      flareContractRegistryAbi,
      "function",
      "getContractAddressByName",
      1,
    );
    expectInputCount(
      flareContractRegistryAbi,
      "function",
      "getAllContracts",
      0,
    );
    expectInputCount(harborRedeemerAbi, "function", "assetManagerAddress", 0);
    expectInputCount(harborRedeemerAbi, "function", "fAssetTokenAddress", 0);
    expectInputCount(harborRedeemerAbi, "function", "lotSizeUBA", 0);
    expectInputCount(harborRedeemerAbi, "function", "assetDecimals", 0);
    expectInputCount(harborRedeemerAbi, "function", "defaultKeeperExecutor", 0);
    expectInputCount(harborRedeemerAbi, "function", "executeDefault", 2);
    expectInputCount(
      harborRedeemerAbi,
      "function",
      "setDefaultKeeperExecutor",
      1,
    );
    expectInputCount(
      harborRedeemerAbi,
      "event",
      "DefaultKeeperExecutorUpdated",
      1,
    );
    expectInputCount(
      harborRedeemerAbi,
      "event",
      "RedemptionDefaultForwarded",
      3,
    );
    assert.equal(
      harborRedeemerAbi.some(
        (item) =>
          item.type === "function" &&
          "name" in item &&
          (item.name as string) === "redeemViaHarbor",
      ),
      false,
    );
    assert.equal(harborContractPlaceholders.redeemer.address, undefined);
    assert.equal(harborContractPlaceholders.redeemer.abi, harborRedeemerAbi);
  });

  test("exports upstream-style ABI aliases for later prompts", () => {
    assert.equal(iAssetManagerAbi, assetManagerAbi);
    assert.equal(iAssetManagerEventsAbi, assetManagerEventsAbi);
    assert.equal(iFAssetAbi, fAssetAbi);
    assert.equal(iFdcHubAbi, fdcHubAbi);
    assert.equal(ftsoV2InterfaceAbi, ftsoV2Abi);
    assert.equal(iRelayAbi, relayAbi);
    assert.equal(iFlareContractRegistryAbi, flareContractRegistryAbi);
    assert.equal(harborContractAbi, harborRedeemerAbi);
  });
});
