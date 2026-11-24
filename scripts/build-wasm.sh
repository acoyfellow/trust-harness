#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export PATH="$HOME/.cargo/bin:$PATH"
cd "$ROOT"

cargo build --release --target wasm32-unknown-unknown --workspace

mkdir -p dist
cp target/wasm32-unknown-unknown/release/trust_preflight.wasm dist/preflight.wasm
cp target/wasm32-unknown-unknown/release/trust_admit.wasm dist/admit.wasm
cp target/wasm32-unknown-unknown/release/trust_observe.wasm dist/observe.wasm
cp target/wasm32-unknown-unknown/release/trust_verdict.wasm dist/verdict.wasm

if [ "${1:-}" = "--check" ]; then
  (cd dist && shasum -a 256 -c wasm.sha256)
else
  (cd dist && shasum -a 256 preflight.wasm admit.wasm observe.wasm verdict.wasm > wasm.sha256)
  (cd dist && shasum -a 256 -c wasm.sha256)
fi
ls -lh dist/*.wasm
