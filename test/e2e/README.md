# Harbor E2E — Full Live Test Suite (Flare Coston2)

Comprehensive, **no-mock** TypeScript/ethers.js v6 end-to-end test suite that
drives the full Harbor FAssets FXRP redemption-default lifecycle against the
**real Coston2 testnet** (chainId 114). Every check verifies on-chain state via
contract calls and events.

## Quick start

```bash
cd test/e2e
npm install                      # ethers v6 (+ esbuild/tsx dev deps)

# Read-only verification (safe; sends NO transactions):
npx tsx harbor-e2e.ts
#   or in restricted sandboxes:
node run.mjs

# Full run incl. state-changing txs (needs FXRP — see "Blockers" below):
RUN_MUTATIONS=true npx tsx harbor-e2e.ts

# Full FDC proof pipeline (~3-6 min, ~1000 wei fee; no FXRP needed):
RUN_FDC_PROOF=true npx tsx harbor-e2e.ts

# Keeper sweep — scan for & execute real defaults (needs RUN_MUTATIONS):
RUN_KEEPER_SWEEP=true RUN_MUTATIONS=true npx tsx harbor-e2e.ts

npm run typecheck                # strict tsc, no emit
```

Config is env-driven with verified testnet defaults baked in — see
[`.env.example`](./.env.example). Exit code `0` = no hard failures
(`BLOCKED`/`SKIP` never fail the run); `1` = a `FAIL`.

## Latest results

### Read-only run (no FXRP, no txs) — [`last-run.txt`](./last-run.txt)
```
Totals: 25 passed, 0 failed, 2 blocked, 5 skipped  (of 32)
```

### Full FDC proof + keeper sweep (`RUN_FDC_PROOF=true RUN_KEEPER_SWEEP=true`) — [`fdc-proof-run.txt`](./fdc-proof-run.txt)
```
Totals: 26 passed, 0 failed, 3 blocked, 3 skipped  (of 32)
```
T5e (full FDC proof → on-chain verify) **passes live and repeatably**; T5f
(keeper sweep, 50 000-block lookback) reports `0` Harbor-nominated, expired,
unpaid candidates — there is simply no defaultable redemption to execute (see
[T5c status](#t5c-status--the-only-thing-left) below).

### Live happy-path run (mutations ON, 10 FXRP funded) — [`mutation-run.txt`](./mutation-run.txt)
```
Totals: 28 passed, 0 failed, 2 blocked, 0 skipped
```

The happy path was verified end-to-end:
- `approve` → `redeem(1 lot)` → `RedemptionRequested` (requestId 38242590)
- Agent settled on XRPL → `RedemptionPerformed` → 10 FXRP burned
- XRPL payment independently verified: tx `AC16B892…EEBC3F` (`tesSUCCESS`),
  9.95 XRP delivered, memo matching on-chain `paymentReference` byte-for-byte

### Full FDC proof pipeline (RUN_FDC_PROOF=true)
```
FdcVerification.verifyReferencedPaymentNonexistence => TRUE
```

A real, finalized, on-chain-valid `ReferencedPaymentNonexistence` proof was
generated and verified against the FdcVerification contract — the exact input
`executeDefault` consumes.

## Test groups

| Group | What it verifies (live) |
|-------|------------------------|
| **T0** | RPC up, chainId 114, head block, signer gas balance |
| **T1** | Bytecode sizes; **proxy works / impl reverts** (Diamond); registry; executor wiring; FXRP identity |
| **T2** | `getSettings` snapshot; per-agent `getAgentInfo`; executor owner/keeper; FdcHub + Relay |
| **T3** | FXRP balance check; if short → `BLOCKED` with faucet steps + mint alternative |
| **T4** | `approve` → `redeem` → `RedemptionRequested` → poll `RedemptionPerformed` → assert FXRP burned |
| **T5** | 5a encode RPNE request · 5b live verifier `prepareRequest` · 5c full default (FdcHub → finalize → DA proof → `executeDefault` → `RedemptionDefault`) · 5d premature-default revert · 5e **full FDC proof → on-chain verify == true** · 5f **keeper sweep → execute real default** |
| **T6** | `executeDefault` delegates to `redemptionPaymentDefault`; `setDefaultKeeperExecutor` owner-only + zero-addr guard; owner dry-run |
| **T7** | insufficient FXRP; zero lots; bad XRPL address (client + on-chain); nonexistent redemption; redeem-on-impl |

## Key findings

1. **Call the PROXY, not the implementation.** The AssetManager is an EIP-2535
   Diamond. Calls to the proxy (`0xc1Ca…`) succeed; calls to the "implementation"
   (`0xebac…`) revert with `missing revert data`. T1 asserts this.

2. **FXRP is faucet-provisioned.** `faucet.flare.network` dispenses 10 FTestXRP
   / address / 24h (= 1 lot) but is reCAPTCHA-gated → not scriptable. T3 reports
   `BLOCKED` with exact manual steps + code-minting alternative.

3. **FDC verifier accepts the public testnet key** `00000000-0000-0000-0000-000000000000`
   — no real secret required.

4. **This wallet controls the keeper.** The Harbor executor's `owner` and
   `defaultKeeperExecutor` are both `0xcE77…2F88`.

5. **Full FDC proof pipeline works live.** T5e generates a real
   `ReferencedPaymentNonexistence` attestation, waits for voting-round
   finalization, retrieves the DA-layer Merkle proof, and verifies it on-chain
   via `FdcVerification.verifyReferencedPaymentNonexistence == true`.

6. **`redemptionPaymentDefault` is redeemer/executor-gated.** The custom error
   selector `0xba0514c0` decodes to `InvalidRequestId()` — the AssetManager
   rejects defaults from callers who are neither the recorded redeemer nor the
   nominated executor. This is correct access control, not a bug.

7. **DA-layer proof publication is not instant (suite fix).** After a voting
   round finalizes, the DA layer returns `204`/`404` or a transient `400`
   (`{"error":"attestation request not found"}`) for ~10-30 s before the Merkle
   proof is published. The suite previously treated any non-`204`/`404` as fatal,
   so `T5e` (and therefore `T5c`/`T5f`) **failed on this race**. `daLayerProof`
   now treats transient `400`/`425`/`5xx` as "not ready — keep polling". Verified
   live: `400` for ~25 s, then `200` with the proof; on-chain verify `== true`.

8. **The RPNE `amount` is GROSS `valueUBA`, not net.** Per the official FAssets
   redemption-default guide and Harbor's keeper, the non-existence proof uses
   `amount = valueUBA`. Agents pay the **net** amount (`valueUBA − feeUBA`; the
   fee is retained), so the verifier attests non-existence of the *gross* amount
   even for a fully-paid redemption — the on-chain **status** check, not the
   amount, is what prevents defaulting a paid redemption. Verified live against
   `requestId 38242590` (paid): `amount=valueUBA` → `VALID`; `amount=valueUBA-feeUBA`
   → `INVALID: REFERENCED TRANSACTION EXISTS`. `buildRPNEBody` keeps gross (correct).

9. **`HARBOR_DEFAULTED_REQUEST_ID` now runs the real default (suite fix).**
   Previously it built a *synthetic* body and then blocked on `synthetic`, so it
   never exercised the supplied id. `5a` now looks the redemption up by its
   indexed `requestId` and builds the **real** request body, and `5c` guards
   against already-settled ids (so it never spends an attestation on a redemption
   that can no longer default).

## T5c status — the only thing left

`T5c` is a live `executeDefault(proof, requestId)` that emits `RedemptionDefault`
with a real collateral payout. It requires a redemption that (a) the agent did
**not** pay before the window expired and (b) is still active (defaultable).

**That input does not exist on Coston2 right now, and cannot be forced here:**

- **Keeper sweep (Approach 1).** Scanned **4 670 redemptions across ~500 000
  blocks (~10 days)**: `4 441` performed, `238` payment-blocked, **`0` defaults
  ever**, **`0` open/defaultable**. All 4 Harbor-nominated redemptions were
  fulfilled. `T5f` at a 50 000-block lookback finds `0` candidates. → nothing to
  execute.
- **Create our own (Approach 2).** Needs FXRP; wallet holds `0` and the faucet is
  reCAPTCHA-gated (unscriptable). Even with FXRP, agents fulfill ~100 % within the
  window (`0` defaults in 4 670 redemptions), so a self-created redemption is paid,
  not defaulted.

So `T5c` is **BLOCKED by external reality (reliable agents + a gated faucet), not
by any code issue.** Everything `executeDefault` actually consumes is proven live:
the full FDC `ReferencedPaymentNonexistence` proof finalizes and verifies on-chain
(`T5e`, repeatable), the executor→`redemptionPaymentDefault` delegation and access
control are exercised (`T6`), and all six failure modes revert correctly (`T7`).

The moment a defaultable redemption appears, the suite completes `T5c` unattended:
```bash
RUN_MUTATIONS=true RUN_KEEPER_SWEEP=true KEEPER_SWEEP_LOOKBACK=50000 npx tsx harbor-e2e.ts
# …or, for a known id:
RUN_MUTATIONS=true HARBOR_DEFAULTED_REQUEST_ID=<id> npx tsx harbor-e2e.ts
```

## Blockers & alternatives

- **No FXRP in the wallet** → T4 (happy path) is `BLOCKED`. Get 10 FTestXRP from
  `https://faucet.flare.network/coston2` (reCAPTCHA, 1 lot / 24h), then re-run
  with `RUN_MUTATIONS=true`.
- **No naturally-defaulting agent** → T5c full on-chain default (collateral
  payout) needs a redemption whose XRPL payment window expired unpaid. All 4
  live agents have 100% fulfillment. Supply `HARBOR_DEFAULTED_REQUEST_ID` or use
  `RUN_KEEPER_SWEEP=true` to scan for one automatically.

## Files

```
harbor-e2e.ts          the suite (single script) — T0…T7 + runner + summary
src/harbor-abis.json   ABIs + addresses (from @harbor/protocol)
run.mjs                sandbox runner (esbuild-bundle → node; ethers external)
scripts/dump-abis.mjs  regenerate harbor-abis.json from the Harbor monorepo
scripts/sweep-scan.mjs fast parallel keeper-sweep recon (Approach 1) — counts
                       defaultable candidates + fulfillment stats over a wide range
package.json           scripts: test / test:mutations / typecheck
tsconfig.json          strict TS config
.env.example           full configuration reference
last-run.txt           captured read-only run transcript
fdc-proof-run.txt      captured RUN_FDC_PROOF + RUN_KEEPER_SWEEP transcript
mutation-run.txt       captured live happy-path run transcript
```

> Testnet only. The default `PRIVATE_KEY` is the throwaway key from the task
> brief — never reuse it or fund the address with anything of value.
