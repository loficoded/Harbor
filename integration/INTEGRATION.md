# Harbor Read API — Integration Guide

Harbor exposes a **public, read-only, no-auth JSON API** that any wallet,
explorer, dashboard, or protocol can consume. It surfaces two things the FAssets
ecosystem currently has no shared source for:

1. **Agent reliability** — a transparent, term-by-term heuristic score per FXRP
   agent (fulfillment, settlement speed, availability, collateral), plus the
   agent's official on-chain name/icon.
2. **Redemption settlement status** — the full, evidence-based lifecycle of a
   single redemption (requested → settled, or → defaulted → recovered).

There is **no custody, no smart-contract call, and no key** involved in reading
this data. It is a plain HTTP `GET`. That makes it the lowest-friction way to
add "settlement confidence" signals to an existing product.

> Informational only. FAssets assigns redemption agents **FIFO** — this data
> never selects or influences which agent fulfils a redemption. The score is a
> heuristic (`scoreIsHeuristic: true`), never a settlement guarantee.

---

## Base URL

```
https://api-production-6f3ec.up.railway.app
```

All responses are `application/json; charset=utf-8`. Every response carries an
`x-request-id` header for support. Numeric on-chain values that exceed
`Number.MAX_SAFE_INTEGER` are returned as **strings** (e.g. `valueUBA`,
`availableLots`, `collateralRatioBips`) — parse them with `BigInt` when needed.

---

## Endpoints

### 1. `GET /health` — service + indexer status

Use it for an uptime check or to show "live on Coston2" freshness.

```bash
curl -s https://api-production-6f3ec.up.railway.app/health
```

```jsonc
{
  "status": "ok",
  "checkedAt": "2026-07-20T09:37:56.691Z",
  "database": { "status": "ok", "migrationsApplied": 7 },
  "indexer": { "cursor": { "chainId": "114", "blockNumber": "33053445" } },
  "keeper": { "totalJobs": 0, "pending": 0, "running": 0, "failed": 0 },
  "build": { "service": "@harbor/api", "environment": "coston2", "gitCommit": "65c44e6" }
}
```

Returns `200` when healthy, `503` otherwise.

---

### 2. `GET /agents` — FXRP agent reliability leaderboard

Query params:

| Param   | Default | Notes                                        |
| ------- | ------- | -------------------------------------------- |
| `asset` | `FXRP`  | FAsset symbol. Unsupported values return 400 |

```bash
curl -s "https://api-production-6f3ec.up.railway.app/agents?asset=FXRP"
```

```jsonc
{
  "asset": "FXRP",
  "scoreIsHeuristic": true,
  "generatedAt": "2026-07-20T10:02:10.372Z",
  "agents": [
    {
      "agentVault": "0x165c62b4531d28e34c68a8b2acbf4d0421e4e028",
      "score": 100,
      "scoreIsHeuristic": true,
      "formulaVersion": "agent-reliability-mvp-v1",
      "fulfillmentRate": 1,
      "fulfillmentScore": 45,
      "settlementTimeScore": 15,
      "availabilityScore": 20,
      "collateralScore": 20,
      "defaultPenalty": 0,
      "successfulRedemptions": 1155,
      "defaultedRedemptions": 0,
      "totalTerminalRedemptions": 1155,
      "averageSettlementSeconds": 19,
      "availability": "AVAILABLE",
      "availableLots": "113",
      "collateralRatioBips": "22851",
      "collateralRatioSource": "INVENTORY",
      "ftsoStatus": "AVAILABLE",
      "details": {
        "name": "Oracle-Daemon 1",
        "description": "Oracle Daemon auxiliary agent bot",
        "iconUrl": "https://raw.githubusercontent.com/TowoLabs/ftso-signal-providers/master/assets/0xfe532cB6Fb3C47940aeA7BeAd4d61C5e041D950e.png",
        "termsOfUseUrl": null
      },
      "updatedAt": "2026-07-20T10:02:10.372Z"
    }
  ]
}
```

**Field reference (per agent):**

| Field                      | Meaning                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `agentVault`               | Agent vault address (stable identifier)                              |
| `score`                    | Heuristic reliability score, `0–100`                                 |
| `fulfillmentScore` (≤45)   | `fulfillmentRate × 45`                                               |
| `settlementTimeScore` (≤15)| Faster average settlement → higher                                   |
| `availabilityScore` (≤20)  | Published availability + free lots                                   |
| `collateralScore` (≤20)    | From collateral ratio (live FTSOv2 prices when not in inventory)     |
| `defaultPenalty` (≤20)     | `min(defaults × 5, 20)`, subtracted                                  |
| `successfulRedemptions`    | Count of settled redemptions observed                                |
| `defaultedRedemptions`     | Count that had to be recovered from collateral                       |
| `averageSettlementSeconds` | Mean time from request to settlement                                 |
| `availableLots`            | Free lots the agent can currently back (string)                      |
| `collateralRatioBips`      | Collateral ratio in basis points (`"22851"` = 228.51%)               |
| `details`                  | Official on-chain `AgentOwnerRegistry` name/description/icon/terms    |

---

### 3. `GET /redemptions/:id` — one redemption's settlement status

`:id` is the FAssets redemption `requestId`. You already have it if your app
initiated the redemption (it's in the `RedemptionRequested` /
`RedemptionWithTagRequested` event); otherwise let the user paste it, or link
straight to Harbor's status page `…/status/:id`. Unknown IDs return `404`.

```bash
curl -s https://api-production-6f3ec.up.railway.app/redemptions/39994560
```

```jsonc
{
  "redemption": {
    "requestId": "39994560",
    "status": "SETTLED",                     // REQUESTED | SETTLED | DEFAULTED | RECOVERED
    "statusReason": "redemption-performed",
    "redemptionKind": "STANDARD",            // STANDARD | WITH_TAG
    "destinationTag": null,                  // set for WITH_TAG (exchange/custodial)
    "redeemer": "0x6f25…12a5",
    "agentVault": "0x5b89…7fc5",
    "agentDetails": { "name": "Oracle-Daemon 2", "iconUrl": "https://…", "termsOfUseUrl": null },
    "paymentAddress": "r4PBDuDjDDPveiJeBctDJdhze9VqFCYMAj",
    "valueUBA": "50000000",                  // gross underlying (drops); net = value − fee
    "feeUBA": "250000",
    "executor": "0x103b…f437",
    "executorFeeNatWei": "100000000000",
    "transactionHash": "0x534b…8fa1",
    "defaultTransactionHash": null,
    "createdAt": "2026-07-20T10:01:06.039Z",
    "updatedAt": "2026-07-20T10:04:30.392Z"
  },
  "statusTimeline": [
    { "status": "REQUESTED", "occurredAt": "2026-07-20T10:01:06.039Z", "source": "REDEMPTION" },
    { "status": "SETTLED",   "occurredAt": "2026-07-20T10:04:30.392Z", "source": "REDEMPTION" }
  ],
  "xrplReceipts": [],
  "fdcRequests": [],
  "fdcProofs": [],
  "defaultTransactionHash": null,
  "generatedAt": "2026-07-20T10:05:44.263Z"
}
```

The timeline, receipts, and proofs are built from **stored evidence** (the
on-chain request, XRPL settlement receipt, FDC request/proof, and the submitted
default) — not an inferred state path.

---

## Quickstart: plain `fetch`

```js
const API = "https://api-production-6f3ec.up.railway.app";

// Reliability leaderboard, ranked by score
const { agents } = await fetch(`${API}/agents?asset=FXRP`).then((r) => r.json());
agents
  .sort((a, b) => b.score - a.score)
  .forEach((a) =>
    console.log(
      (a.details.name ?? a.agentVault),
      "score", a.score,
      "settled", a.successfulRedemptions,
      "defaults", a.defaultedRedemptions,
    ),
  );

// One redemption's status
const status = await fetch(`${API}/redemptions/39994560`).then((r) => r.json());
console.log(status.redemption.status); // "SETTLED"
```

## React

See [`HarborAgentReliability.tsx`](./HarborAgentReliability.tsx) — copy the file
in and render `<HarborAgentReliability />`.

## Plain HTML (no build step)

See [`harbor-widget.html`](./harbor-widget.html) — one self-contained file. Copy
the `<div id="harbor-reliability">` element and the `<script>` block into any
page, or embed it directly: `<iframe src="harbor-widget.html">`.

---

## CORS (required for browser embeds)

The API decides `Access-Control-Allow-Origin` from `HARBOR_API_CORS_ORIGINS`:

- Empty / unset or `*` → sends `Access-Control-Allow-Origin: *` (any site).
- A comma-separated allow-list → echoes the origin **only** if it matches.

Since this data is **public and read-only**, set `HARBOR_API_CORS_ORIGINS=*` on
the Railway service so any partner can embed the widget. To lock it to specific
partners instead, list their exact origins:

```
HARBOR_API_CORS_ORIGINS=https://partner-explorer.app,https://app.partner.io
```

Server-to-server callers (no browser) are unaffected by CORS.

---

## Good to know

- **No pagination / no rate limit today.** `/agents` returns the full set in one
  response; be a courteous client and poll no more than once per ~30–60s.
- **Testnet.** Data is Coston2. The same shapes apply to a future mainnet
  deployment.
- **Stability.** Treat the base URL as stable; if it ever changes, prefer a
  custom domain (e.g. `api.harbor.…`) so integrations don't break.
