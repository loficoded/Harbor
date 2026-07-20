# Harbor

> **A guaranteed-settlement layer for FXRP redemptions on Flare — now with a destination-tag redemption lane.**

> 🏆 **Built for the [Flare Summer Signal](https://dorahacks.io/hackathon/flaresummersignal) hackathon.**
> Project submission (BUIDL): **[dorahacks.io/buidl/46944](https://dorahacks.io/buidl/46944)**.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2022-5FA04E?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-000?logo=next.js&logoColor=white)
![Solidity](https://img.shields.io/badge/Solidity-0.8.25-363636?logo=solidity&logoColor=white)
![Flare Coston2](https://img.shields.io/badge/Flare-Coston2-E62058)

Harbor sits between an FXRP redeemer and the agent that owes them XRP, ensuring that missed payments automatically trigger FAssets default recovery. Because it never custodies funds, recovered collateral is always paid directly to you.

|             |                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------ |
| Live demo   | [harbor-web-olive.vercel.app](https://harbor-web-olive.vercel.app)                         |
| Backend API | [api-production-6f3ec.up.railway.app](https://api-production-6f3ec.up.railway.app)         |
| Walkthrough | ▶ [Watch the new demo video on YouTube](https://www.youtube.com/watch?v=TABAwMhMG20)       |

[![Harbor — FXRP redemption console on Flare Coston2](./assets/screenshots/redemption-console.png)](https://www.youtube.com/watch?v=TABAwMhMG20)

<p align="center"><em>▶ <a href="https://www.youtube.com/watch?v=TABAwMhMG20">Watch the demo video</a> — redeem → watch XRPL → settle, or prove non-payment → execute default → recover collateral.</em></p>

*Note: High-res video assets are also available in the repository at `assets/loom/video.mp4` (90-second walkthrough) and `assets/demo/harbor-demo.mp4` (2-minute product demo).*

## Features

- **Non-custodial by construction:** Harbor acts as the nominated executor. You redeem directly on the `AssetManager`, so default collateral is paid to you.
- **Two Redemption Lanes:**
  - **Standard (`redeemAmount`):** Uses the `ReferencedPaymentNonexistence` proof and `HarborRedeemer.executeDefault`.
  - **Redeem-by-tag (`redeemWithTag`):** For XRPL destinations requiring a tag. Uses the XRP-native `XRPPaymentNonexistence` proof and `HarborRedeemer.executeXrpDefault`. (Tag `0` is valid; an empty input uses the standard lane. Automatically disabled if `redeemWithTagSupported()` is false).
- **No agent selection:** FAssets handles agent assignment via FIFO.
- **Permissionless self-recovery:** Anyone can complete a stuck default directly from the UI using the pre-built FDC proof bytes.
- **Heuristic reliability scoring:** Ranks agents (`agent-reliability-mvp-v1`) based on fulfillment, speed, availability, and FTSOv2 collateral ratios. Purely informational analytics.
- **Fast XRPL settlement observer:** Validates `netUnderlyingUBA` (`valueUBA - feeUBA`) and destination tags directly from the ledger.
- **Durable indexing:** FAssets indexer recovers events across RPC gaps via a persisted cursor.
- **Zero-config local dev:** Everything boots in "mock mode" with local defaults.

## Architecture & Lifecycle

Harbor is a Next.js 14 / Node.js 22 pnpm monorepo. The core system operates on the Flare Coston2 testnet.

```mermaid
flowchart LR
    R["Redeemer"] -->|"redeemAmount / redeemWithTag"| AM["FXRP AssetManager"]
    AM -->|"Redemption(WithTag)Requested"| IDX["Indexer"]
    AG["Agent"] -->|"pays XRP (with tag if WITH_TAG)"| XRPL[("XRP Ledger")]
    OBS["XRPL Observer"] -->|"validates payment"| XRPL
    KEEP{"Keeper"} -->|"watch window"| OBS
    KEEP -->|"expired: prove non-payment"| FDC[("Flare Data Connector")]
    FDC -->|"Merkle proof"| KEEP
    KEEP -->|"execute(Xrp)Default"| HR["HarborRedeemer"]
    HR -->|"forward default"| AM
    AM -->|"collateral"| R
```

### Comprehensive Sequence (Settlement & Recovery)

```mermaid
sequenceDiagram
    autonumber
    actor R as Redeemer / UI
    participant AM as FXRP AssetManager
    participant AG as FAsset Agent
    participant XRPL as XRP Ledger
    participant OBS as XRPL Observer
    participant KEEP as Keeper
    participant API as Read API
    participant FDC as Flare Data Connector
    participant DA as DA Layer
    participant HR as HarborRedeemer

    R->>AM: redeemAmount / redeemWithTag (nominate HarborRedeemer)
    AM-->>API: RedemptionRequested / RedemptionWithTagRequested
    Note over KEEP: status REQUESTED → WATCHING
    AG->>XRPL: pay net underlying XRP (with tag if WITH_TAG)

    loop poll window
        OBS->>XRPL: read agent address
    end
    OBS->>OBS: validate destination, reference, net amount, window, tag

    alt Agent Pays (Settlement)
        OBS-->>API: write settlement receipt
        KEEP->>API: read valid observation
        Note over KEEP: status → SETTLED
        R->>API: GET /redemptions/:id
    else Window Expires (Default Recovery)
        Note over KEEP: window expired, no valid payment → WINDOW_EXPIRED

        alt STANDARD Lane
            KEEP->>FDC: submit ReferencedPaymentNonexistence request
        else WITH_TAG Lane
            KEEP->>FDC: submit XRPPaymentNonexistence request
        end

        Note over KEEP: status → REQUEST_PROOF
        KEEP->>FDC: track voting round to finalization
        KEEP->>DA: retrieve response + Merkle proof
        Note over KEEP: status → PROOF_READY

        alt Keeper Submits Default
            alt STANDARD Lane
                KEEP->>HR: executeDefault(proof, requestId)
                HR->>AM: redemptionPaymentDefault(proof, requestId)
            else WITH_TAG Lane
                KEEP->>HR: executeXrpDefault(proof, requestId)
                HR->>AM: xrpRedemptionPaymentDefault(proof, requestId)
            end
        else Permissionless Self-Recovery (Keeper Offline)
            R->>API: GET /redemptions/:id (fdcProofs[])
            R->>HR: executeDefault / executeXrpDefault (proof, id)
            HR->>AM: redemptionPaymentDefault / xrpRedemptionPaymentDefault
        end

        AM-->>R: collateral to recorded redeemer
        AM-->>HR: return executor fee
        HR-->>KEEP: forward fee to caller
        Note over KEEP: status → DEFAULT_SUBMITTED → RECOVERED
    end
```

### Keeper State Machine

The keeper evaluates requests deterministically. Front-running it via self-recovery is harmless.

```mermaid
stateDiagram-v2
    [*] --> REQUESTED
    REQUESTED --> WATCHING: window open
    WATCHING --> SETTLED: valid XRPL payment observed
    REQUESTED --> WINDOW_EXPIRED: window already passed
    WATCHING --> WINDOW_EXPIRED: window passed, no payment
    WINDOW_EXPIRED --> REQUEST_PROOF: submit FDC request
    REQUEST_PROOF --> PROOF_READY: voting round finalized
    PROOF_READY --> DEFAULT_SUBMITTED: execute(Xrp)Default sent
    DEFAULT_SUBMITTED --> RECOVERED: default confirmed on-chain
    PROOF_READY --> RECOVERED: default confirmed (front-run harmless)
    SETTLED --> [*]
    RECOVERED --> [*]

    REQUESTED --> FAILED
    WATCHING --> FAILED
    WINDOW_EXPIRED --> FAILED
    REQUEST_PROOF --> FAILED
    PROOF_READY --> FAILED
    DEFAULT_SUBMITTED --> FAILED
    FAILED --> [*]
```

## Agent Reliability Scoring

Formula (`agent-reliability-mvp-v1`) clamped to `[0, 100]`:
```text
fulfillment      (≤ 45)  = fulfillment_rate · 45 (22.5 if no history)
settlement_time  (≤ 15)  = based on average settlement seconds (fast ≤ 1h, slow ≥ 24h)
availability     (≤ 20)  = from published availability + free lots
collateral       (≤ 20)  = from agent's collateral ratio (floor 120% ... full 200%)
default_penalty  (≤ 20)  = min(defaults · 5, 20) (subtracted)
```
Scores are heuristic and **never** influence the protocol's FIFO agent assignment. Identity data (name, icon) is parsed directly from `AgentOwnerRegistry`.

## Build on Harbor

Public, `GET`-only API providing read-only access to reliability and settlement status:
- `GET /agents?asset=FXRP` — Heuristic agent leaderboard
- `GET /redemptions/:id` — Evidence-based timeline

**Drop-in Integrations:**
- `integration/harbor-widget.html`: Zero-dependency embeddable leaderboard.
- `integration/HarborAgentReliability.tsx`: Configurable React component.
- See `integration/INTEGRATION.md` for full field definitions.

## Getting Started (Development)

Requires Node.js 22+, pnpm 10, and Foundry (for contract checks).

```bash
pnpm install
cp .env.example .env

pnpm --filter @harbor/api dev    # Starts API on :3001
pnpm --filter @harbor/web dev    # Starts Next.js console on :3000
pnpm check                       # Format, typecheck, forge test
```

### Component Toggles (Backend)
Configured via `.env` defaults:
- `HARBOR_RUN_API` (on)
- `HARBOR_RUN_MIGRATIONS` (on)
- `HARBOR_RUN_INDEXER`, `HARBOR_RUN_XRPL_OBSERVER`, `HARBOR_RUN_AGENT_REFRESH`, `HARBOR_RUN_KEEPER` (off)

### Tests
- **Foundry (Contracts):** `pnpm check:contracts` (3 suites)
- **API (node:test):** `pnpm test` in `@harbor/api` (16 suites)
- **Web (Vitest):** `pnpm test` in `@harbor/web` (19 suites)
- **E2E (Playwright):** `pnpm test:e2e` in `@harbor/web` (7 suites)
- **Live Coston2 E2E:** Located in `test/e2e` (`harbor-e2e.ts`, `harbor-tag-e2e.ts`)

## On-chain Deployment (Coston2)

`HarborRedeemer` requires Solidity `0.8.25` and exposes a secure `receive()` hook, `executeDefault`, and `executeXrpDefault` to forward the respective proofs and refund fees. It resolves `AssetManagerFXRP` on initialization.

```bash
# Broadcast deployment
RPC_URL_COSTON2=... DEPLOYER_PRIVATE_KEY=... KEEPER_EXECUTOR_ADDRESS=... pnpm deploy:harbor:coston2
# Regen ABIs
pnpm protocol:generate-harbor-abi
```

**Deployed Addresses:**
- HarborRedeemer: `0x82f39361FFb1a438e4EBF8025efa06e4511b02b5`
- FXRP AssetManager: `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`
- FXRP Token (FTestXRP): `0x0b6A3645c240605887a5532109323A3E12273dc7`

## License
Licensed under Apache 2.0.
