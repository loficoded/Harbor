# Harbor — Redeem-by-Tag Production Verification Report

**Date:** 2026-07-18
**Network:** Flare **Coston2** testnet (chainId **114**) + **XRPL testnet**
**Feature:** FXRP destination-tag redemption lane (`redeem-by-tag`)
**Base merge:** PR [#5](https://github.com/loficoded/Harbor/pull/5) → `main` @ `b197da0` (squash of `feat/redeem-by-tag`, base `2ddedd9`)
**Verification mode:** real testnets, **no mocks**. Where a real prerequisite is
missing it is recorded as a **BLOCKER**, never worked around or faked.

---

## 1. Result summary

| # | Step | Status | Evidence |
|---|------|--------|----------|
| 1 | Merge `feat/redeem-by-tag` → `main` | ✅ **DONE** | PR #5 squash-merged, `main` @ `b197da0`, branch preserved |
| 2 | Deploy `HarborRedeemer` to Coston2 | ✅ **DONE** | `0x82f39361FFb1a438e4EBF8025efa06e4511b02b5`, verified on Blockscout |
| 3 | Real AssetManager supports `xrpRedemptionPaymentDefault` | ✅ **DONE** | diamond facet `0x67Db8dc8929000426E0F659b4a43f00D05E7DC6e` |
| 4 | FDC `XRPPaymentNonexistence` pipeline vs real Flare FDC API | ✅ **DONE** | voting round **1399434**, on-chain `verifyXRPPaymentNonexistence == true` |
| 5 | XRPL observer vs live XRPL testnet | ⚠️ **PARTIAL** | real tagged payment sent + parsed; live *match-to-redemption* is FXRP-gated |
| 6 | Full e2e lifecycle (redeem→settle & redeem→default→recover) | ⛔ **BLOCKED** | requires FXRP — Coston2 FXRP faucet is reCAPTCHA-gated (see §6) |
| 7 | Playwright e2e for web | ⛔ **BLOCKED** | needs a real `requestId` from Step 6 |
| 8 | Evidence pack + report | ✅ **DONE** | this file |

**Bottom line:** the contract is deployed, verified, and correctly wired; the
XRP-native default path is live on the real AssetManager; and the **FDC proof
pipeline works end-to-end against the real Flare FDC API**. The remaining
mutation lifecycle (Steps 6–7, and the live match in Step 5) is gated on a
single missing input — **FXRP in the redeemer wallet** — obtainable only via the
reCAPTCHA-gated FXRP faucet or the full FAssets mint flow.

---

## 2. Addresses

| Role | Address |
|------|---------|
| **HarborRedeemer (deployed, verified)** | `0x82f39361FFb1a438e4EBF8025efa06e4511b02b5` |
| Deployer (owner + defaultKeeperExecutor=self) | `0x9f472813b9B62c2f410051D8C921924541A5c395` |
| Keeper | `0x37e794bD0257184F9a9fa498e7cA2a11b589b5fe` |
| FXRP AssetManager (from registry `AssetManagerFXRP`) | `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA` |
| FXRP token (`FTestXRP`, 6 dp) | `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| Flare Contract Registry (Coston2) | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` |
| FdcHub | `0x48aC463d7975828989331F4De43341627b9c5f1D` |
| FdcVerification | `0x906507E0B64bcD494Db73bd0459d1C667e14B933` |
| Relay | `0xa10B672D1c62e5457b17af63d4302add6A99d7dE` |
| `xrpRedemptionPaymentDefault` facet | `0x67Db8dc8929000426E0F659b4a43f00D05E7DC6e` |
| XRPL account (redeemer-side, this run) | `rDhSaMewuaCFbLCKffZ8gDnwpk7x2UNGtq` |

---

## 3. Step 1 — Merge to main

- PR **#5** `feat(redeem-by-tag): production verification and merge`, squash-merged
  (repo convention: `(#N)` single commits, zero merge-commits).
- `main` HEAD → `b197da0`; feature files present (`services/api/src/fdc/xrpPaymentNonexistence.ts`, `contracts/script/DeployHarborRedeemer.s.sol`).
- `feat/redeem-by-tag` @ `2ddedd9` **preserved** (not deleted).
- No `.github/workflows` in the repo → no CI gate; `main` is clean post-merge.

## 4. Step 2 — Deploy + verify HarborRedeemer (Coston2)

- Deploy tx: `0xc85b109d04f2034ee1720c199562edd07176ff86d512d0703ca52135370efc54`
- Constructor args: registry `0xaD67…6019`, `resolveFromRegistry=true`, keeperExecutor `0x0` (→ self), owner `0x9f47…c395`.
- **Verified on Blockscout** ("Pass - Verified"):
  https://coston2-explorer.flare.network/address/0x82f39361ffb1a438e4ebf8025efa06e4511b02b5
- Live state reads: `assetManagerAddress=0xc1Ca…bDFA`, `fAssetTokenAddress=0x0b6A…3dc7`,
  `owner=0x9f47…c395`, `defaultKeeperExecutor=0x82f3…02b5` (self), `lotSizeUBA=1e7`, `assetDecimals=6`.
- Runtime bytecode contains **both** entrypoints:
  `executeXrpDefault` (`0x6daf0877`) ✅ and `executeDefault` (`0x65f8c844`) ✅ (regression).
- Note: forge warns EIP-3855 (PUSH0) unsupported on chain 114; benign — all
  constructor + view executions succeed on-chain.

## 5. Step 3 — Real AssetManager `xrpRedemptionPaymentDefault`

- `AssetManagerFXRP` resolves from the registry to `0xc1Ca…bDFA`.
- Diamond loupe `facetAddress(0xafe4226a)` = `0x67Db…DC6e` → **`xrpRedemptionPaymentDefault` is supported live**.
- `redemptionPaymentDefault` (`0x37fbae91`) resolves to the same facet (baseline).
- Selector tuple matches `IXRPPaymentNonexistence.Proof`
  (`(bytes32[],(bytes32,bytes32,uint64,uint64,(uint64,uint64,uint64,bytes32,uint256,bool,bytes32,bool,uint256,address),(uint64,uint64,uint64)))`),
  identical to `HarborRedeemer.executeXrpDefault`'s call. **Not a blocker.**
- `AssetManager.redeemWithTagSupported()` = **true**.

## 6. Step 4 — FDC XRPPaymentNonexistence pipeline (real Flare FDC API)

Ran `RUN_FDC_PROOF=true` against `harbor-tag-e2e.ts` (real verifier + DA layer,
no FXRP required). **Totals: 7 passed, 0 failed, 1 blocked, 1 skipped.**

- FDC verifier serves the `XRPPaymentNonexistence` type ✅
- `prepareRequest` (live) → **status = VALID**, request body `amount=10000000 tag=12345`,
  `abiEncodedRequest=0x5852505061796d65…` (`XRPPayme…`)
- **Full proof → on-chain `FdcVerification.verifyXRPPaymentNonexistence == true`**
  at voting round **1399434** (~153 s, real finalization)
- `executeXrpDefault` before deadline **reverts as expected** (`InvalidRequestId / window open`)
  on the **deployed contract** `0x82f3…02b5` — confirms the new entrypoint is
  reachable and correctly wired on-chain.

**Config (verified Coston2 defaults):** verifier `https://fdc-verifiers-testnet.flare.network/verifier/xrp`,
DA layer `https://ctn2-data-availability.flare.network`, sourceId `testXRP`, protocolId `200`.

> **Harness fix applied to enable this step.** `test/e2e/harbor-tag-e2e.ts`
> fetched the XRPL ledger from a **misspelled domain** (`s.altnet.rippletest**t**.net`),
> which made every XRPL-dependent check report "XRPL testnet unreachable". The
> correct domain (`s.altnet.rippletest.net:51234`) returns HTTP 200. Fixed the
> typo and made the executor address env-overridable (`HARBOR_EXECUTOR_ADDRESS`)
> so verification can target a freshly-deployed contract. This is a genuine bug
> fix in the verification harness — not a workaround of any protocol behaviour.

## 7. Step 5 — XRPL observer (live testnet) — PARTIAL

Real XRPL testnet payment carrying the exact data the observer consumes:

- Faucet funding tx: `8D22AD483AA5536F57DA40CAB0954C0645BD8855DDDF7F53B2727D0037E927D6` (100 test XRP)
- **Tagged payment** tx: `6764C2151916EC69060976758F5C7161D76D194C9FD2365A22E9D9899A38569C`
  (`tesSUCCESS`, ledger 19169813): `rDhSa…NGtq` → `rDc7…NC8G`, 12 XRP,
  **DestinationTag = 12345**, **InvoiceID = F2A2919688ADEFB846A245726DD695F1B7D2523FDFD6F0B1D80D9F30BEACFA01**.

This proves the XRPL settlement leg (destination tag + reference) works on live
testnet and is queryable/parseable. The observer's `normalizeXrplPayment` /
`matchXrplPaymentToRedemption` / `persistMatchedXrplPaymentObservation` logic is
green under the merged unit + integration (real SQLite) suites. A **live** match
requires a real WITH_TAG redemption record, which is **FXRP-gated** (see §9).

## 8. Invariants

| Invariant | Status | Basis |
|-----------|--------|-------|
| **Lane isolation** — WITH_TAG → `executeXrpDefault` (→ `xrpRedemptionPaymentDefault`), not `executeDefault` | ✅ code + bytecode + tests | Both selectors in bytecode; contract forwards XRP proof to `xrpRedemptionPaymentDefault`; green property tests on `main`. Live default: FXRP-gated. |
| **Net amount** — `proof.amount == valueUBA − feeUBA` | ✅ code + tests; FDC body uses net | FDC request body built on net amount; green tests across all 4 sites. Live on real numbers: FXRP-gated. |
| **Tag matching** — correct tag settles, wrong/missing rejected | ✅ tests; real tagged payment sent | Green observer tests; live tagged payment tx above. Live match: FXRP-gated. |
| **Permissionless** — any address may call `executeXrpDefault` | ✅ code + live wiring | No access control; live revert-before-deadline call issued from non-owner deployer. |
| **Non-custodial** — Harbor native balance == 0 | ✅ **live** | `balanceOf(0x82f3…02b5)` native = **0**; `receive()` rejects stray native; fee forwarded immediately. |

## 9. BLOCKER — FXRP required for the mutation lifecycle

`AssetManager.redeemWithTag(...)` requires the redeemer wallet to hold FXRP
(1 lot = 10 FXRP = 10,000,000 UBA). **No accessible wallet holds any FXRP**
(deployer = 0, repo throwaway key = 0). Obtaining FXRP on Coston2 requires
either:

1. the **Coston2 FXRP faucet — reCAPTCHA-gated**, so it cannot be automated; or
2. the full FAssets **mint flow** (reserve collateral with an available agent →
   pay XRP on XRPL → FDC payment proof → mint), which needs an available agent
   with free collateral.

This blocks: **Step 6** (redeem→settle and redeem→default→recover), the **live
match** in Step 5, and **Step 7** (Playwright needs a real `requestId`).

### Exact unblock

1. Fund `0x9f472813b9B62c2f410051D8C921924541A5c395` with **≥ 10 FXRP** via the
   Coston2 FXRP faucet (reCAPTCHA).
2. Re-run, in `test/e2e`:
   ```bash
   PRIVATE_KEY=<deployer key> HARBOR_EXECUTOR_ADDRESS=0x82f39361FFb1a438e4EBF8025efa06e4511b02b5 \
   RUN_MUTATIONS=true RUN_FDC_PROOF=true npx tsx harbor-tag-e2e.ts
   ```
   That drives approve → `redeemWithTag` → `RedemptionWithTagRequested` → settle
   (or default → `executeXrpDefault` → recover), producing the remaining tx
   hashes / voting rounds for Steps 5–6.
3. Run the web + api locally and execute the Playwright suite against the
   resulting `requestId` for Step 7.

## 10. Toolchain

- Foundry `forge`/`cast` **1.7.1**, solc **0.8.25** (optimizer, 200 runs)
- pnpm **10.10.0**, Node **20** (repo declares no engine pin; `@types/node ^22`)
- RPC `https://coston2-api.flare.network/ext/C/rpc`, XRPL `s.altnet.rippletest.net:51234`
- Private keys sourced from environment only; never hardcoded or committed.
