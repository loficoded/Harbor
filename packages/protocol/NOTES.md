# Protocol Interface Notes

Verified against `@flarenetwork/flare-periphery-contracts@0.1.52`, Flare Developer Hub, and live Coston2 registry reads on 2026-07-07.

## Coston2 Addresses

- Flare Contract Registry: `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`
- `AssetManagerFXRP`: `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`
- FXRP FAsset token from `AssetManager.fAsset()`: `0x0b6A3645c240605887a5532109323A3E12273dc7`
- `FdcHub`: `0x48aC463d7975828989331F4De43341627b9c5f1D`
- `FdcVerification`: `0x906507E0B64bcD494Db73bd0459d1C667e14B933`
- `Relay`: `0xa10B672D1c62e5457b17af63d4302add6A99d7dE`
- `FtsoV2`: `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d`

## Verified Interface Names

- `IAssetManager.redeem(uint256,string,address payable)` exists and is payable.
- `IAssetManager.redeemAmount(uint256,string,address payable)` exists through the extended redemption interface.
- `IAssetManager.redemptionPaymentDefault(IReferencedPaymentNonexistence.Proof,uint256)` exists.
- `IAssetManager.getSettings()`, `fAsset()`, `getAllAgents(uint256,uint256)`, `getAvailableAgentsList(uint256,uint256)`, `getAvailableAgentsDetailedList(uint256,uint256)`, and `getAgentInfo(address)` exist.
- The default event is named `RedemptionDefault`, not `RedemptionDefaulted`.
- `IFdcHub.requestAttestation(bytes)` is payable and emits `AttestationRequest(bytes,uint256)`.
- `FtsoV2Interface.getFeedById(bytes21)` is payable; callers may need to call `calculateFeeById(bytes21)` first.
- `IRelay.isFinalized(uint256,uint256)` and `getVotingRoundId(uint256)` are available for finalization-aware polling.

## Behavior To Re-check Before Prompt #04

The Harbor contract must not assume wrapper redemption is non-custodial until Coston2 behavior is proven with a live or forked test:

1. If `HarborRedeemer` calls `AssetManager.redeem`, verify whether `RedemptionRequested.redeemer` is the wrapper contract or the original end user.
2. Verify where successful default collateral and premium are delivered after `redemptionPaymentDefault`: directly to the recorded redeemer, to the caller, or through another payout path.
3. If the wrapper is recorded as redeemer or receives default payouts, Prompt #04 must avoid the wrapper redemption path and make the frontend call `AssetManager.redeem` directly with the Harbor keeper as executor.
4. The FDC non-payment request for plain XRPL redemption must use `checkSourceAddresses=false`.

These semantics decide whether Harbor can safely wrap `redeem` or should only provide permissionless default execution helpers for the MVP.
