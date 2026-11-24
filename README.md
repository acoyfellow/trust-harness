# trust-harness

One `@alchemy.run/domain` model that stacks all four deterministic Rust-to-WASM agent trust boundaries behind one shared ABI and one fail-closed, SHA-256-pinned loader.

## The four boundaries of an agent turn

| # | Boundary | Crate | What it enforces |
|---|---|---|---|
| 1 | **Preflight** | `crates/preflight` | Request part byte limits, total byte budget, supported kinds, trust labels, untrusted authority-spoof blocks |
| 2 | **Admit** | `crates/admit` | `write`, `edit`, `bash`, and `lockfile` policy (secret paths, `--no-verify`, `curl \| sh`, force push, non-public/http registries) |
| 3 | **Observe** | `crates/observe` | Fact-driven validation of external tool results (`trusted`, `hostile-retrieval`, `false-success`, `terminal-fault`, `invalid`) |
| 4 | **Verdict** | `crates/verdict` | Claimed vs observed fields (`held`, `broken`, `unbacked`, `unclaimed`) → `pass`, `retry`, or `ask` |

All four crates share `crates/abi` (`alloc`, `dealloc`, `eval(ptr, len) -> u64`) and load through `src/wasm/loader.ts`, which verifies `dist/wasm.sha256` before instantiation and fails closed on missing or tampered modules.

## Alchemy Domain model

- **Aggregate (`src/Turn/Turn.aggregate.ts`):** enforces strict turn ordering (`Idle → AwaitingPreflight → Active → Closed`). Refuses tool admission before preflight, observation of un-admitted calls, verdict with pending observations, and any command after close.
- **External System (`src/WasmJudge.external.ts`):** typed boundary calls implemented by `src/wasm/live.ts` over the pinned `.wasm` binaries.
- **Policy & Saga (`src/Turn/TurnLaunch.policy.ts`, `src/Turn/RunTurn.saga.ts`):** runs submitted turns sequentially through all four boundaries and fails closed via `BlockTurn` if any boundary module is unavailable.
- **View (`src/TurnReceipt.view.ts`):** projects every boundary decision, its exact `.wasm` SHA-256, and final turn outcome into a per-turn receipt.

## Verify

```sh
sh gate.sh
```

`gate.sh` runs:
1. `cargo test --workspace` (18 Rust unit tests across all 4 boundaries)
2. Release `wasm32-unknown-unknown` builds + `dist/wasm.sha256` verification
3. `tsc --noEmit`
4. `vitest run` (`Domain.verify(TrustHarness) === []`, Domain stories, live `.wasm` end-to-end tests, `eval/bypasses.json` replay, fail-closed mute/tamper controls, and always-allow negative control)
5. `node scripts/mutate-check.mjs` (11 deliberate Domain, loader, saga, and Rust rule breaks — must kill 100%)
6. `gitleaks` clean scan

## Known limits (`eval/bypasses.json`)

WASM makes the rule kernel deterministic and non-injectable. It does not replace OS/container isolation or truthful upstream observations:
- Obfuscated bash (`eval` + `base64`) slips past static bash token checks; run commands inside a sandboxed box.
- False `observed_proof: true` or wrong upstream extraction still flows through deterministically.
- Paraphrased semantic prompt injection without override phrases is not caught by static preflight text checks.
- Currently in-memory Domain only; not deployed to Cloudflare Workers/DOs.
