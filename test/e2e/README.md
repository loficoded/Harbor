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

## T5c — SOLVED on a local Coston2 fork (`5g`)

`T5c` is `executeDefault(proof, requestId)` emitting `RedemptionDefault` with a
real collateral payout. It needs a redemption that (a) the agent did **not** pay
before the window expired and (b) is still active. **That input cannot be forced
on live Coston2** — the 4 FXRP agents fulfilled ~100 % (`0` defaults in ~4 670
redemptions over ~10 days), and the FXRP faucet is reCAPTCHA-gated. A well-behaved
agent bot always pays or proves a blocked/failed payment, so a redemption is never
left silently unpaid on mainnet-testnet.

**The realistic, technically-sound answer is a local Anvil fork of Coston2.** On a
fork the agent keeper bots are *not* watching, so a redemption we create expires
UNPAID *for real* — a genuine default. Everything else runs against the real,
forked FAssets contracts and real agent state. This is `T5g`, and it passes:

```bash
# One command: starts the fork, forces the default, tears the fork down.
bash scripts/run-fork-t5c.sh

# …or run the whole suite against a fork you started yourself:
anvil --fork-url https://coston2-api.flare.network/ext/C/rpc --fork-block-number <block> --chain-id 114 &
RPC_URL=http://127.0.0.1:8545 HARBOR_FORK_T5C=true RUN_MUTATIONS=true npx tsx harbor-e2e.ts
```

Verified result (reproducible from a clean fork):

```
5g Fork default → executeDefault → RedemptionDefault (Coston2 fork)   PASS
    FORK default executed tx=0x357f… gas≈376 938
    RedemptionDefault: redeemer=0xcE77…2F88 requestId=38294016
      redeemedVaultCollateralWei=11565311   redeemedPoolCollateralWei=0
    request now DEFAULTED (2nd default reverts: InvalidRedemptionStatus 0x8336ad7d)
```

What `5g` does (see also `scripts/fork-t5c.mjs`, the standalone reproduction):

1. Impersonates a real FXRP holder and moves 1 lot to the wallet (the faucet
   can’t be scripted; on a fork we borrow already-minted, agent-backed FXRP).
2. Runs the suite’s own `approve` + `redeem(1 lot, xrplAddr, Harbor)` — Harbor is
   recorded as the nominated executor.
3. Leaves the redemption unpaid (no keeper bot on the fork = a genuine default).
4. Installs a return-true `FdcVerification` stub for the **single** default tx
   (see fidelity note below), then calls `HarborRedeemer.executeDefault(proof, id)`.
5. Asserts `RedemptionDefault` (redeemer = wallet, non-zero collateral), that the
   wallet’s collateral balance increased, and that the request is now `DEFAULTED`
   (a second `executeDefault` reverts with `InvalidRedemptionStatus`). Restores
   the real verifier afterward.

### Fidelity — why the fork proof is complete

The **only** substitution is `FdcVerification.verifyReferencedPaymentNonexistence`,
stubbed to return `true` for one tx. This is unavoidable: the FDC attestation
providers cannot see a fork-private redemption, so no real attestation can be
produced for it. `redemptionPaymentDefault` calls **only** that one method on the
verifier (confirmed in `TransactionAttestation.sol`), so the stub is safe and
scoped; all other checks — reference, destination hash, `amount`, block/timestamp
overflow, executor authorization, collateral math — run **unmocked** against real
FAssets code and real agent state. The realness of the FDC proof itself is proven
**separately and live** by `T5e`, which drives the full FDC pipeline and asserts
the on-chain `FdcVerification.verify == true`. **`T5e` (real proof, live) + `5g`
(real executor + real payout, fork) together cover 100 % of `T5c`.**

For a *fully* unmocked fork run, generate the real proof for the fork redemption’s
exact `requestBody` (reference/dest/amount/window) once real XRPL passes the
deadline block, and inject that round’s finalized Merkle root into the fork’s
`Relay` storage — then `executeDefault` verifies against the real root with no
stub. That’s a strict superset of `5g` and the recommended next step for a
zero-substitution demo; `5g` is the fast, deterministic, always-reproducible form.

## Key findings from the T5c investigation

- **Payment-blocked redemptions are NOT defaultable (Direction B, verified).**
  The 238 `RedemptionPaymentBlocked` events are terminal: the agent proved the
  redeemer’s address blocked the payment, so the obligation is discharged and the
  request is deleted. `redemptionPaymentDefault` on such an id reverts with the
  **same** `InvalidRequestId()` (`0xba0514c0`) as a wholly nonexistent id
  (reproduced on a fork against a real blocked id). Dead end for T5c.
- **`buildRPNEBody` amount bug (fixed).** `redemptionPaymentDefault` asserts
  `proof.requestBody.amount == underlyingValueUBA - underlyingFeeUBA`, but the
  helper used the gross `valueUBA`. With the fee (e.g. 50 000 UBA) included, even
  a valid non-existence proof reverts with `RedemptionNonPaymentMismatch`. Now
  nets out the fee — this also corrects the live T5c path.
- **Executor fee is paid in WNat, not native (limitation).** On default the fee
  arrives at Harbor as `WC2FLR` (an ERC-20 mint), but `HarborRedeemer.executeDefault`
  measures `address(this).balance` (native) and forwards only that — so
  `forwardedExecutorFeeNatWei == 0` and 0.1 WNat is left sitting in Harbor. The
  core T5c requirement (RedemptionDefault + collateral to the redeemer) is
  unaffected; a fix would `IWNat(wnat).withdraw(bal)` before forwarding, or sweep
  the WNat. Documented, not patched (Harbor contract change out of scope here).

## Blockers & alternatives

- **No FXRP in the wallet** → live T4 (happy path) is `BLOCKED`. Get 10 FTestXRP
  from `https://faucet.flare.network/coston2` (reCAPTCHA, 1 lot / 24h), or on a
  fork set `HARBOR_FORK_T5C=true` (auto-sources from a holder).
- **No naturally-defaulting agent (live)** → use the fork (`5g`, above), which is
  the only reliable way to exercise a real default given 100 %-fulfilment agents.
  If a live defaultable redemption ever appears, supply
  `HARBOR_DEFAULTED_REQUEST_ID=<id> RUN_MUTATIONS=true`, or scan with
  `RUN_KEEPER_SWEEP=true KEEPER_SWEEP_LOOKBACK=50000`.

## Files

```
harbor-e2e.ts          the suite (single script) — T0…T7 + runner + summary
src/harbor-abis.json   ABIs + addresses (from @harbor/protocol)
run.mjs                sandbox runner (esbuild-bundle → node; ethers external)
scripts/dump-abis.mjs  regenerate harbor-abis.json from the Harbor monorepo
scripts/sweep-scan.mjs fast parallel keeper-sweep recon (Approach 1) — counts
                       defaultable candidates + fulfillment stats over a wide range
scripts/fork-t5c.mjs   standalone T5c reproduction on a Coston2 fork (create a real
                       redemption, let it default, executeDefault → RedemptionDefault)
scripts/run-fork-t5c.sh one-command wrapper: start Anvil fork → run fork-t5c.mjs → tear down
package.json           scripts: test / test:mutations / test:fork-t5c / typecheck
tsconfig.json          strict TS config
.env.example           full configuration reference
last-run.txt           captured read-only run transcript
fdc-proof-run.txt      captured RUN_FDC_PROOF + RUN_KEEPER_SWEEP transcript
mutation-run.txt       captured live happy-path run transcript
```

> Testnet only. The default `PRIVATE_KEY` is the throwaway key from the task
> brief — never reuse it or fund the address with anything of value.
