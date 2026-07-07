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
pnpm smoke:protocol-imports
```

If Foundry is not installed locally, `pnpm check:contracts` is expected to fail until `forge test --root contracts` is available.

## HarborRedeemer Deployment

The deployment script is `contracts/script/DeployHarborRedeemer.s.sol:DeployHarborRedeemer`.
It defaults to the Coston2 Flare contract registry and resolves `AssetManagerFXRP`
through the registry. Override `HARBOR_ASSET_MANAGER_OR_REGISTRY_ADDRESS` and set
`HARBOR_RESOLVE_ASSET_MANAGER_FROM_REGISTRY=false` to deploy against a direct
AssetManager address.

Required Coston2 broadcast variables:

```sh
RPC_URL_COSTON2=
DEPLOYER_PRIVATE_KEY=
KEEPER_EXECUTOR_ADDRESS=
```

Optional constructor overrides:

```sh
HARBOR_ASSET_MANAGER_OR_REGISTRY_ADDRESS=
HARBOR_RESOLVE_ASSET_MANAGER_FROM_REGISTRY=true
HARBOR_OWNER_ADDRESS=
```

Dry-run against Coston2 without a private key:

```sh
RPC_URL_COSTON2=https://coston2-api.flare.network/ext/C/rpc pnpm deploy:harbor:coston2:dry-run
```

Broadcast to Coston2 only after funding the deployer:

```sh
RPC_URL_COSTON2=https://coston2-api.flare.network/ext/C/rpc \
DEPLOYER_PRIVATE_KEY=... \
KEEPER_EXECUTOR_ADDRESS=... \
pnpm deploy:harbor:coston2
```

Do not use these scripts for mainnet, Songbird, or production hosting in the MVP
prompt sequence.

The Coston2 explorer is Blockscout-based. Verification is optional for local
tests and can be run after deployment with the deployed address and constructor
arguments, for example:

```sh
forge verify-contract \
  --root contracts \
  --chain-id 114 \
  --verifier blockscout \
  --verifier-url https://coston2-explorer.flare.network/api/ \
  <HARBOR_REDEEMER_ADDRESS> \
  src/HarborRedeemer.sol:HarborRedeemer
```

Regenerate the typed HarborRedeemer ABI after contract changes:

```sh
pnpm protocol:generate-harbor-abi
```

Downstream packages should import `harborRedeemerAbi`,
`HARBOR_REDEEMER_ADDRESS`, or `harborRedeemerAddress` from `@harbor/protocol`.
