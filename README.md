# Harbor

Harbor is a planned guaranteed-settlement layer for FXRP redemptions on Flare. This repository currently contains the workspace foundation only; protocol logic, contracts, backend flows, and frontend features are intentionally deferred to later implementation prompts.

## Workspace Layout

- `apps/web` - placeholder TypeScript package for the future Next.js dApp.
- `services/api` - minimal Node/TypeScript service package for the future API, indexer, and keeper.
- `packages/shared` - shared TypeScript types and utilities.
- `packages/protocol` - future home for chain IDs, contract ABIs, addresses, and protocol helpers.
- `contracts` - Foundry project for Solidity code.
- `docs` - architecture notes and staged implementation prompts.

## Tooling

The workspace uses `pnpm` for JavaScript and TypeScript packages. Foundry is used for Solidity compilation under `contracts`.

Required local tools:

- Node.js 22 or compatible current LTS.
- pnpm 10.
- Foundry `forge` for contract checks.

## Commands

```sh
pnpm install
pnpm check
```

Useful package-level checks:

```sh
pnpm --filter @harbor/api health
pnpm --filter @harbor/shared check
pnpm --filter @harbor/protocol check
pnpm check:contracts
```

If Foundry is not installed locally, `pnpm check:contracts` is expected to fail until `forge build --root contracts` is available.
