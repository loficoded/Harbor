# @harbor/web

The Harbor dApp shell: a Next.js 14 App Router application (TypeScript, Tailwind
CSS) that provides the operational surface for FXRP redemption on Flare Coston2.
Users redeem an arbitrary amount of FXRP (via `redeemAmount`) and track
settlement. The FAssets protocol assigns redemption agents automatically (FIFO),
so the console has no agent-selection control; the `/agents` page is
informational analytics only.

## Commands

Run from the repo root (they resolve the workspace packages this app depends
on) or from `apps/web`:

```sh
pnpm --filter @harbor/web dev        # start the dev server (default port 3000)
pnpm --filter @harbor/web build      # production build
pnpm --filter @harbor/web start      # serve the production build
pnpm --filter @harbor/web typecheck  # tsc --noEmit
pnpm --filter @harbor/web lint       # next lint
pnpm --filter @harbor/web test       # vitest unit/component run
pnpm --filter @harbor/web test:e2e   # playwright smoke tests
```

`@harbor/shared` and `@harbor/protocol` must be built before typechecking or
testing this app (their compiled `dist/` provides types and the Coston2 chain
data). `pnpm -r --sort build` handles that ordering; `pnpm smoke:protocol-imports`
from the root builds them and then typechecks the app.

## Wallet and network configuration

Wallet state uses `wagmi` + `viem`, wired to Flare Coston2 (chain id `114`). The
chain definition is projected from `@harbor/protocol` so there is a single
source of truth for RPC and explorer URLs.

Configuration comes from the `NEXT_PUBLIC_*` variables in `.env.example`
(Prompt #03). Every value has a safe local default so the app runs with no
configuration ("mock mode"):

| Variable                               | Purpose                       | Default when unset                           |
| -------------------------------------- | ----------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_HARBOR_API_URL`           | Backend base URL (Prompt #15) | `http://localhost:3001`                      |
| `NEXT_PUBLIC_RPC_URL_COSTON2`          | Coston2 RPC endpoint          | public Coston2 RPC from the protocol package |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect project id      | unset → WalletConnect disabled               |
| `NEXT_PUBLIC_HARBOR_CONTRACT_ADDRESS`  | HarborRedeemer address        | unset → not yet used in this prompt          |

- **WalletConnect is optional.** Without a project id the app still runs and
  offers injected browser wallets only; the WalletConnect connector is added
  only when the id is present.
- **Network guard.** When a connected wallet is on the wrong chain, a banner
  offers a one-click switch to Coston2 where the wallet supports programmatic
  switching, and otherwise instructs a manual switch.

## Routes

- `/` — the redemption console: submit a redemption (an arbitrary FXRP amount
  and an XRPL destination; no agent is chosen — the protocol assigns agents
  FIFO) and look up an existing redemption by id. Explains the FIFO model
  inline.
- `/agents` — the agent statistics page: informational analytics only (observed
  fulfillment, settlement speed, availability, collateral, and a heuristic
  score). It carries a FIFO notice and does not select or influence which agent
  fulfills a redemption.
- `/status/[id]` — the live redemption status view. It reads
  `GET /redemptions/:id`, polls until the redemption reaches a terminal state
  (settled, recovered, or failed), and renders the lifecycle timeline, the XRPL
  settlement receipt, and default-recovery detail (FDC request/proof status,
  default transaction, recovered state). Additional request ids from a single
  redemption are shown as a compact related-requests list (from the `more` query
  param). The self-recovery transaction is reserved for a later prompt; the view
  shows a clearly-labeled, disabled placeholder for it.

### Status polling and SSE

The status view polls by default (TanStack Query `refetchInterval`, 5s) and
stops once the status is terminal. It does **not** use SSE: the backend exposes
no event-stream endpoint, and this frontend does not add one. If the backend
later gains an `/events` stream, the container is the single place to layer it
in on top of the existing polling fallback.

## Testing

- **Unit/component:** Vitest + Testing Library (`src/**/*.test.{ts,tsx}`),
  covering layout rendering, network-guard states, API client base-URL handling,
  the missing-WalletConnect fallback, the status view-model derivation
  (`redemption-status.test.ts`, one case per lifecycle status plus settlement,
  recovery, related-request, and malformed-response handling), and the status
  view component (`redemption-status-view.test.tsx`, every major status plus the
  loading, empty, not-found, API-error, and stale-data states).
- **End-to-end:** Playwright (`tests/e2e`) smoke-loads `/`, `/agents`, and
  `/status/test`, drives the redeem happy path, and exercises the status view
  against mocked `GET /redemptions/:id` responses (`status.spec.ts`: settled
  receipt, default recovery in progress, recovered default, not found). All
  specs run under desktop and mobile viewport projects. Browsers are installed
  with `pnpm --filter @harbor/web exec playwright install chromium`.
