#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")" && pwd)
export PATH="$HOME/.cargo/bin:$PATH"
TMP_DIR=/tmp/trust-harness
VITEST_JSON="$TMP_DIR/vitest-gate.json"
MUTATIONS_JSON="$TMP_DIR/mutations-gate.json"
MANIFEST_BEFORE="$TMP_DIR/manifest-before.sha256"

mkdir -p "$TMP_DIR"
cleanup() {
  rm -rf "$VITEST_JSON" "$MUTATIONS_JSON" "$MANIFEST_BEFORE"
}
trap cleanup EXIT

cd "$ROOT"
shasum -a 256 dist/wasm.sha256 > "$MANIFEST_BEFORE"

echo "[1/7] cargo test --workspace --lib"
cargo test --workspace --lib --quiet

echo "[2/7] build all 4 wasm modules and check against committed dist/wasm.sha256"
sh scripts/build-wasm.sh --check

echo "[3/7] tsc --noEmit"
npm run -s typecheck

echo "[4/7] vitest (Domain.verify, stories, live WASM, 57/57 admit + 578/578 verdict parity, 4/4 tamper + negative controls)"
npx vitest run --silent --reporter=json --outputFile="$VITEST_JSON"

echo "[5/7] mutation kill check (Domain + loader + saga + rebuilt WASM end-to-end)"
MUTATIONS_OUT="$MUTATIONS_JSON" node scripts/mutate-check.mjs

echo "[6/7] gitleaks scan + verify dist/wasm.sha256 untouched"
gitleaks detect --no-banner --no-git -s . > /dev/null
shasum -a 256 -c "$MANIFEST_BEFORE" > /dev/null

echo "[7/7] write .receipt.json from real check outputs"
node scripts/write-receipt.mjs "$VITEST_JSON" "$MUTATIONS_JSON" "$ROOT/.receipt.json"
echo "GATE PASSED -> .receipt.json"
