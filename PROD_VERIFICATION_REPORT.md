# Harbor — Redeem-by-Tag Production Verification Report

**Date:** 2026-07-18
**Network:** Flare **Coston2** testnet (chainId **114**) + **XRPL testnet**
**Feature:** FXRP destination-tag redemption lane (`redeem-by-tag`)
**Base merge:** PR [#5](https://github.com/loficoded/Harbor/pull/5) → `main` @ `b197da0` (squash of `feat/redeem-by-tag`, base `2ddedd9`)
**Verification mode:** real testnets, **no mocks**. Blockers are recorded, never faked.

---

## 1. Result summary

| # | Step | Status | Key evidence |
|---|------|--------|--------------|
| 1 | Merge `feat/redeem-by-tag` → `main` | ✅ **DONE** | PR #5 squash-merged, branch preserved |
| 2 | Deploy `HarborRedeemer` (Coston2) | ✅ **DONE** | `0x82f39361FFb1a438e4EBF8025efa06e4511b02b5`, verified on Blockscout |
| 3 | Real AssetManager `xrpRedemptionPaymentDefault` | ✅ **DONE** | diamond facet `0x67Db…DC6e`; `redeemWithTagSupported()==true` |
| 4 | FDC `XRPPaymentNonexistence` pipeline (real FDC API) | ✅ **DONE** | round **1399434**, on-chain `verifyXRPPaymentNonexistence==true` |
| — | FXRP acquisition (mint, faucet is reCAPTCHA-gated) | ✅ **DONE** | full FAssets mint incl. FDC **Payment** proof (round **1399454**) → **20 FXRP** |
| 5 | XRPL observer vs live XRPL testnet | ✅ **DONE** | agent settlement tag payment parsed & matched to redemption |
| 6a | Lifecycle **redeem → settle** | ✅ **DONE (live)** | `redeemWithTag` #39665162 → agent paid 9.95 XRP tag 12345 → `RedemptionPerformed` |
| 6b | Lifecycle **redeem → default → recover** | ⚠️ **COMPONENTS VERIFIED** | entrypoint + FDC nonexistence proof + AssetManager method all live; a live default needs an agent to *not* pay (agents honor redemptions — cannot be forced) |
| 7 | Playwright web e2e | ⏳ **PENDING** | real `requestId` 39665162 now available; needs local web+api stack |
| 8 | Evidence pack + report | ✅ **DONE** | this file |

**Bottom line:** the redeem-by-tag lane is proven end-to-end on real testnets — deploy, the XRP-native FDC proof pipeline, FAssets minting, and the **complete happy-path lifecycle** (`redeemWithTag` → agent settlement with the correct destination tag → `RedemptionPerformed`). Every core invariant is confirmed on **real numbers**.

---

## 2. Addresses

| Role | Address |
|------|---------|
| **HarborRedeemer (deployed, verified)** | `0x82f39361FFb1a438e4EBF8025efa06e4511b02b5` |
| Deployer / minter / redeemer (owner) | `0x9f472813b9B62c2f410051D8C921924541A5c395` |
| Keeper | `0x37e794bD0257184F9a9fa498e7cA2a11b589b5fe` |
| FXRP AssetManager | `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA` |
| FXRP token (`FTestXRP`, 6 dp) | `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| Minting/redeeming agent vault | `0x55c815260cBE6c45Fe5bFe5FF32E3C7D746f14dC` |
| Flare Contract Registry | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` |
| FdcHub / FdcVerification / Relay | `0x48aC…5f1D` / `0x9065…B933` / `0xa10B…d7dE` |
| Redeemer XRPL account | `rDhSaMewuaCFbLCKffZ8gDnwpk7x2UNGtq` |
| Agent XRPL address | `r4uKJRy9mjxGHw1yzS1SrtaKCUwT66MCcP` |

---

## 3. Step 1 — Merge to main
PR **#5** squash-merged (repo convention), `main` @ `b197da0`; `feat/redeem-by-tag` @ `2ddedd9` preserved. No CI workflows → clean merge.

## 4. Step 2 — Deploy + verify
- Deploy tx `0xc85b109d04f2034ee1720c199562edd07176ff86d512d0703ca52135370efc54`
- Verified on Blockscout: https://coston2-explorer.flare.network/address/0x82f39361ffb1a438e4ebf8025efa06e4511b02b5
- State: assetManager `0xc1Ca…bDFA`, fAsset `0x0b6A…3dc7`, owner deployer, defaultKeeperExecutor=self, lotSize `1e7`, decimals 6.
- Bytecode contains `executeXrpDefault` (`0x6daf0877`) and `executeDefault` (`0x65f8c844`).

## 5. Step 3 — Real AssetManager XRP default
`facetAddress(0xafe4226a)` (`xrpRedemptionPaymentDefault`) = `0x67Db…DC6e`; selector tuple matches `IXRPPaymentNonexistence.Proof`; `redeemWithTagSupported()==true`. **Not a blocker.**

## 6. Step 4 — FDC XRPPaymentNonexistence pipeline (real FDC API)
`RUN_FDC_PROOF=true` → **7 passed, 0 failed**. `prepareRequest` VALID; full proof → on-chain **`verifyXRPPaymentNonexistence==true`** at voting round **1399434**; `executeXrpDefault` reverts-before-deadline on the deployed contract (live wiring).

> Harness fix (committed): corrected a misspelled XRPL domain (`rippletestt.net`) that had been falsely reporting "XRPL unreachable", and made the executor address env-configurable (`HARBOR_EXECUTOR_ADDRESS`).

## 7. FXRP minting (FAssets flow — no faucet)
The Coston2 FXRP faucet is reCAPTCHA-gated, so FXRP was obtained via the full FAssets mint, exercising the FDC **Payment** attestation end-to-end:
- `reserveCollateral` (agent `0x55c8…14dC`, 1 lot) tx `0xf5ca63275b4f2c0b017aee0b1ce5b1162f9c44f3cb00decf6b44e4d2c575a59d`, reservationId **42738779**, fee 1.676 C2FLR
- Underlying XRP paid: XRPL tx `9E82DE3F1FCAAE4EE3889DC5046BB7100BC231426BA08F8B4B62CD55968EEDB1` — 10.025 XRP, reference memo `46425052…028C245B`
- FDC **Payment** proof: round **1399454**, `standardPaymentReference` matched exactly, `status=0` (SUCCESS)
- `executeMinting` tx `0xb663f9622a292be72f23c4a3631ad0668aa5fb83c82254b10ac833996ae0e971` → **20 FXRP** minted (the agent bot co-executed, yielding 2 lots)

## 8. Steps 5 + 6a — Redeem → settle (live, full lifecycle)
- **Redeem:** `approve` + `redeemWithTag(1 lot, rDhSa…NGtq, executor=Harbor, tag=12345)` → **`RedemptionWithTagRequested`**
  tx `0x31f5cf2eab8f3b5ebea398cf87006c9a0665d681bdfcf21b0444db89033db92c`
  requestId **39665162**, `redemptionKind=WITH_TAG`, `destinationTag=12345`, executor `0x82f3…02b5`,
  valueUBA 10,000,000, feeUBA 50,000, paymentReference `0x46425052…025d3e0a`. FXRP burned 20 → 10.
- **Settle (agent → redeemer on XRPL):** tx `26059274CBB74F7E7E98609C126E7D13CBA11BB2D92095CF4FF01F9629A10478`
  (ledger 19170384): **9,950,000 drops (9.95 XRP)**, **DestinationTag 12345**, **MemoData = paymentReference byte-for-byte** (`…025D3E0A`).
- **Finality (on-chain):** **`RedemptionPerformed`** tx `0xf52e7fa636f9cf59743247cdf3936a25edeede7c33b89b3594958056dccde3ba`
  (block 32991678): requestId 39665162, `transactionHash` = the XRPL settlement above, redemptionAmountUBA 10,000,000, spentUnderlyingUBA 9,950,012.

This is exactly the observer's match target (`normalizeXrplPayment` → `matchXrplPaymentToRedemption`): a real XRPL payment carrying the correct destination tag + reference + net amount, tied to the WITH_TAG redemption.

## 9. Step 6b — Redeem → default → recover
All machinery is verified live: `HarborRedeemer.executeXrpDefault` is deployed, wired, and reverts-before-deadline; the FDC `XRPPaymentNonexistence` proof pipeline returns `true` on-chain (§6); and the real AssetManager exposes `xrpRedemptionPaymentDefault` (§5). A **live** end-to-end default additionally requires a redemption the agent never pays — but Coston2 agents honor redemptions (demonstrated in §8, the agent settled promptly), so a real default cannot be forced with honest agents. This matches the repo's prior finding (T5c requires a fork). **Not a code defect** — an environmental constraint of honest live agents.

## 10. Invariants (confirmed on real data)

| Invariant | Status | Basis |
|-----------|--------|-------|
| **Lane isolation** — WITH_TAG uses the XRP lane | ✅ live | `RedemptionWithTagRequested` (distinct event) w/ `destinationTag`; `executeXrpDefault`→`xrpRedemptionPaymentDefault` wired |
| **Net amount** — `amount == valueUBA − feeUBA` | ✅ live | agent paid **9,950,000 = 10,000,000 − 50,000** |
| **Tag matching** — correct tag settles | ✅ live | agent settlement carried **DestinationTag 12345**; reference memo matched byte-for-byte |
| **Permissionless** — any address may call `executeXrpDefault` | ✅ | no access control; live revert-before-deadline call from non-owner |
| **Non-custodial** — Harbor native balance == 0 | ✅ live | `balanceOf(0x82f3…02b5)` native = 0 |

## 11. Toolchain
Foundry `forge`/`cast` **1.7.1**, solc **0.8.25**; pnpm **10.10.0**, Node **20**; ethers v6.
RPC `https://coston2-api.flare.network/ext/C/rpc`; FDC verifier `fdc-verifiers-testnet.flare.network/verifier/xrp`; DA layer `ctn2-data-availability.flare.network`; XRPL `s.altnet.rippletest.net:51234`.
Private keys sourced from environment only; never hardcoded or committed.
