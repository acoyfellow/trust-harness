#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")" && pwd)
export PATH="$HOME/.cargo/bin:$PATH"
cd "$ROOT"

echo "[1/7] cargo test --workspace"
cargo test --workspace --quiet

echo "[2/7] build all 4 wasm modules and verify sha256"
sh scripts/build-wasm.sh > /dev/null
sh scripts/build-wasm.sh --check

echo "[3/7] tsc --noEmit"
npm run -s typecheck

echo "[4/7] vitest (Domain.verify, stories, live WASM, mute + negative controls, bypasses)"
npm test -- --silent

echo "[5/7] mutation kill check"
node scripts/mutate-check.mjs

echo "[6/7] gitleaks scan"
gitleaks detect --no-banner --no-git -s . > /dev/null

echo "[7/7] write receipt.json"
node scripts/write-receipt.mjs
echo "GATE PASSED -> receipt.json"
