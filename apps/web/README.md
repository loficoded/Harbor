# @harbor/web

The Harbor dApp shell: a Next.js 14 App Router application (TypeScript, Tailwind
CSS) that provides the operational surface for FXRP redemption status and agent
comparison on Flare Coston2. This package is the frontend foundation only —
approval/redeem transactions, the agent leaderboard, and self-recovery are
intentionally deferred to later prompts.

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

- `/` — the redemption console (usable app surface, not a marketing page): look
  up a redemption by id and jump to agent comparison.
- `/agents` — placeholder for the agent reliability leaderboard.
- `/status/[id]` — placeholder for the redemption status view.

## Testing

- **Unit/component:** Vitest + Testing Library (`src/**/*.test.{ts,tsx}`),
  covering layout rendering, network-guard states, API client base-URL handling,
  and the missing-WalletConnect fallback.
- **End-to-end:** Playwright (`tests/e2e`) smoke-loads `/`, `/agents`, and
  `/status/test` under desktop and mobile viewport projects. Browsers are
  installed with `pnpm --filter @harbor/web exec playwright install chromium`.
