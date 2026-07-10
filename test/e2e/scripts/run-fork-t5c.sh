#!/usr/bin/env bash
# =============================================================================
# run-fork-t5c.sh — one-command reproduction of Harbor T5c on a Coston2 fork.
#
# Starts a local Anvil fork of Coston2, runs scripts/fork-t5c.mjs (which creates
# a real redemption, lets it default, and drives HarborRedeemer.executeDefault
# -> RedemptionDefault), then tears the fork down. Exits non-zero if T5c fails.
#
# Requires: foundry (anvil, cast) on PATH, and `ethers` installed in test/e2e
# (npm install ethers@6). See test/e2e/README.md.
#
# Usage:  bash scripts/run-fork-t5c.sh
# =============================================================================
set -euo pipefail

FORK_RPC="${FORK_RPC:-https://coston2-api.flare.network/ext/C/rpc}"
PORT="${ANVIL_PORT:-8545}"
LOCAL_RPC="http://127.0.0.1:${PORT}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v anvil >/dev/null 2>&1 || { echo "anvil not found on PATH. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"; exit 1; }
command -v cast  >/dev/null 2>&1 || { echo "cast not found on PATH."; exit 1; }

echo "resolving Coston2 head from ${FORK_RPC} ..."
HEAD="$(cast block-number --rpc-url "$FORK_RPC")"
FORK_BLOCK="${FORK_BLOCK:-$((HEAD - 20))}"
echo "forking Coston2 at block ${FORK_BLOCK}"

anvil --fork-url "$FORK_RPC" --fork-block-number "$FORK_BLOCK" \
      --port "$PORT" --host 127.0.0.1 --chain-id 114 >/tmp/anvil-fork-t5c.log 2>&1 &
ANVIL_PID=$!
cleanup() { kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

# Wait for the fork to accept RPC.
for i in $(seq 1 30); do
  if cast block-number --rpc-url "$LOCAL_RPC" >/dev/null 2>&1; then break; fi
  sleep 1
done
echo "fork ready at $(cast block-number --rpc-url "$LOCAL_RPC") on ${LOCAL_RPC}"

RPC_URL="$LOCAL_RPC" node "${SCRIPT_DIR}/fork-t5c.mjs"
