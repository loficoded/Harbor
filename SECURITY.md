# Security

Harbor is a guaranteed-settlement layer for FXRP redemptions on Flare. This
document describes its security model, hardening, and how to report issues.

## Reporting a vulnerability

Please **do not** open a public issue for security reports. Email the
maintainers privately with a description, impact, and reproduction steps. We aim
to acknowledge within 72 hours.

## Trust model

- **Non-custodial by construction.** `HarborRedeemer` never holds redeemer
  collateral. Users redeem directly on the FXRP `AssetManager`, which records
  the caller as the redeemer and pays default collateral to that recorded
  redeemer — never to Harbor or the transaction submitter. Harbor only forwards
  the executor fee to `msg.sender`.
- **On-chain proof verification is the root of trust.** Default recovery is
  gated by an FDC (Flare Data Connector) Merkle proof that the `AssetManager`
  verifies against the Relay root on-chain. The backend, keeper, and DA layer
  cannot forge a settlement or a default; a bad or stale proof simply reverts.
- **Permissionless self-recovery is safe.** `executeDefault` /
  `executeXrpDefault` are intentionally callable by anyone. Front-running the
  keeper is harmless because collateral is paid to the recorded redeemer
  regardless of who submits.
- **The read API is public and read-only.** `GET /agents` and
  `GET /redemptions/:id` expose only already-public chain/ledger data. Agent
  reliability scores are heuristic analytics and never influence the protocol's
  FIFO agent assignment.

## Secrets

- **Never commit private keys or API secrets.** `.env` and `.env.*` are
  git-ignored (only `.env.example` templates are tracked). `.env.example` files
  ship with empty secret values and inline guidance.
- **Keeper / deployer keys are read from the environment only** — never from CLI
  flags, which leak via process listings (`ps`, `/proc`) and shell history.
- For production, hold contract ownership in a multisig and load signer keys
  from a secrets manager / KMS. Rotate any key that has ever touched source
  control or a shared machine.

## Application hardening

- **Web app** (`apps/web`): a Content-Security-Policy plus `X-Frame-Options`,
  `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, and
  `Permissions-Policy` are applied to every route (see `security-headers.mjs`).
  Agent-controlled metadata (name, icon, terms URL) is rendered through React
  escaping and `http(s)`-only URL guards. Self-recovery transactions target a
  fixed configured contract address with client-side proof validation, so a
  compromised API cannot redirect a user's wallet transaction.
- **Read API** (`services/api`): GET-only, fully parameterized SQLite queries,
  strict input normalization, CORS allow-listing, per-client rate limiting
  (configurable via `HARBOR_API_RATE_LIMIT*`), and redaction of internal error
  details from client responses (full errors are logged server-side).

## Rate limiting

The API enables per-client fixed-window rate limiting by default. Behind a
trusted proxy (e.g. Railway) leave `HARBOR_API_TRUST_PROXY=true` so limiting is
per originating client. Tune with `HARBOR_API_RATE_LIMIT` (requests) and
`HARBOR_API_RATE_LIMIT_WINDOW_MS` (window); set
`HARBOR_API_RATE_LIMIT_ENABLED=false` to disable.

## Supply chain

- Dependencies are pinned via `pnpm-lock.yaml`; no package defines install
  lifecycle scripts.
- CI runs secret scanning (gitleaks), `pnpm audit`, type-checks, unit/integration
  tests, and Foundry contract tests on every push and pull request.
