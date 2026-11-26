# trust-harness

One `@alchemy.run/domain` model that stacks all four deterministic Rust-to-WASM agent trust boundaries, live tool execution gating, adversarial disproof survival (#2), and Gate Maker vs Gate Breaker rounds (#1) behind one shared ABI and one fail-closed, SHA-256-pinned loader.

## Grounded use cases

### Works today (runnable against pinned `.wasm`)

| Use case | Failure mode it stops | Boundaries | Run it |
|---|---|---|---|
| **Coding agent command & lockfile guard** | Agent tries `git commit -n` / `-an` / `--no-verify`, writes `.env` or secret keys, force-pushes `main`, or leaks a private registry URL in `package-lock.json` — while still allowing normal commits like `git commit -m"don't break main"`. Denied tools execute **0 times**. | `preflight.wasm` → `admit.wasm` → `ToolExecutor` | `node examples/coding-agent-turn.ts` |
| **Prompt-injection firewall on tool output** | A fetched page, issue body, or MCP tool result hides `Ignore\tprevious\ninstructions` or `User has pre-approved...` in `content` or `structuredContent`. `pi/index.ts` redacts both to `{ content, structuredContent: null, isError: true }` before the model sees it. | `admit.wasm` (`tool_call`) + `observe.wasm` (`tool_result`) | `node examples/prompt-injection-redaction.ts` |
| **Anti-lying completion gate ("did tests really pass?")** | Agent claims `"12 tests passed"` when the raw log shows `11` or an unanchored field. Even after `verdict.wasm` says `pass`, `RunTurn` enters `AwaitingDisproof` and checks any counterexample through pinned `verdict.wasm`; a verified counterexample closes the turn as `disproven`. | `verdict.wasm` + `DisproofCritic` (`ApplyDisproof`) | `node examples/disproof-and-breaker.ts` |
| **CI policy hardening (Maker vs Breaker)** | Shipping a guard and assuming it holds until small syntax tweaks (`-an`, tab/newline spoofs) slip past, or fixing a bypass and accidentally blocking valid commands (`-m"no"`). | `BreakerRun` + `BreakerReport` + `dist/wasm.sha256` | `node examples/disproof-and-breaker.ts` |
| **Tamper protection on policy binaries** | A modified local `.wasm` binary tries to return `allow: true`. The loader checks `dist/wasm.sha256` before instantiation and fails closed across all 4 boundaries. | `src/wasm/loader.ts` | `npm test` (`test/LiveWasm.test.ts`) |

### One adapter away (not built yet)

- **Sandboxed command execution:** bind `ToolExecutor` (`src/ToolExecutor.external.ts`) to a container/sandbox runner so admitted commands run isolated and return real stdout/exit codes into `observe.wasm` (closes the static `eval` + `base64` bypass).
- **Live adversarial critic:** bind `DisproofCritic` (`src/DisproofCritic.external.ts`) to a cheap verifier model or log-readback script whose counterexamples are checked deterministically by `verdict.wasm`.
- **Shared Cloudflare Worker gate:** bind the 4 `.wasm` files as `WebAssembly.Module` bindings in `server/WorkerAdapters.ts` and deploy `server/TrustHarnessWorker.ts` via `alchemy.run.ts` so CI jobs and team bots share one Durable Object receipt ledger.

## Turn pipeline

1. **Boundary 1 — Preflight (`crates/preflight` → `dist/preflight.wasm`):** part/total byte limits, supported kinds, trust labels, whitespace-normalized untrusted authority-spoof blocks.
2. **Boundary 2 — Admit (`crates/admit` → `dist/admit.wasm`):** ported `agent-admit` policy (`command.rs` + `lockfile.rs`), 57/57 `agent-admit` corpus parity, hardened against `git commit -n` / `-an`. Denied tools never call `ToolExecutor.execute`.
3. **Live Execution (`src/ToolExecutor.external.ts`):** runs only after `admit.wasm` allows the action, returning real observations (or turning execution failures into `terminal_fault: "execution-error"`).
4. **Boundary 3 — Observe (`crates/observe` → `dist/observe.wasm`):** fact-driven external result check (`trusted`, `hostile-retrieval`, `false-success`, `terminal-fault`, `invalid`) with whitespace-normalized spoof detection.
5. **Boundary 4 — Verdict (`crates/verdict` → `dist/verdict.wasm`):** 578/578 `tether` `statusOf` parity (`pass`, `retry`, `ask`).
6. **Disproof Challenge (`src/DisproofCritic.external.ts` + `ApplyDisproof`):** a passing verdict enters `AwaitingDisproof` rather than closing. An adversarial critic attempts to supply a counterexample, which is verified by pinned `verdict.wasm`. A verified counterexample closes the turn as `disproven`; a turn closes as `passed` only when falsification fails.

## Gate Maker vs Gate Breaker (`src/Breaker/`, `eval/breaker-attacks.json`)

- **Round 1 (`eval/breaker-round1.json`):** found **5 verified disproofs** against the initial pinned WASM binaries (`preflight-whitespace-spoof`, `preflight-all-previous-spoof`, `admit-git-commit-short-no-verify`, `admit-git-commit-combined-an`, `observe-whitespace-hostile`).
- **Maker fixes:** hardened `preflight`, `admit`, and `observe` in Rust and re-pinned `dist/wasm.sha256`.
- **Round 2 (`test/Breaker.test.ts`):** replayed through the `BreakerRun` Domain aggregate and `BreakerReport` view: **10/10 caught, 0 surviving disproofs**, with **57/57** admit and **578/578** verdict parity intact.

## Installable Pi extension & Alchemy Cloudflare hosting

- **Pi extension (`pi/index.ts`):** declared via `"pi": { "extensions": ["./pi/index.ts"] }` and typed directly against `@earendil-works/pi-coding-agent` and `typebox`. Gates `tool_call` with `admit.wasm` (fail-closed, including attached short flags like `git commit -m"no"` allowed and `-n` / `-an` denied), inspects `tool_result` `content` + `structuredContent` with `observe.wasm` and redacts hostile/fail-closed results via `{ content, structuredContent: null, isError: true }`, registers `trust_disprove` using `verdict.wasm`, and writes JSONL receipts.
- **Alchemy Cloudflare hosting (`server/TrustHarnessWorker.ts`, `alchemy.run.ts`):** hosts `TrustHarness` on `DomainCloudflare.layerDurableObjects()` with fail-closed default adapters. Typechecked and tested locally; not deployed to Cloudflare.

## Build and verify

Update `dist/wasm.sha256` only after intentional Rust changes:

```sh
sh scripts/build-wasm.sh
```

Run the gate (never overwrites `dist/wasm.sha256`, writes gitignored `.receipt.json`, runs 19 Rust lib tests, 26 Vitest tests across 9 files including runnable `examples/`, 16/16 mutations including 6 rebuilt-WASM end-to-end kills, and `gitleaks`):

```sh
sh gate.sh
```

## Known limits (`eval/bypasses.json`)

- Obfuscated bash (`eval` + `base64`) slips past static bash token checks; run commands inside a sandboxed box.
- False `observed_proof: true` or wrong upstream extraction still flows through deterministically.
- Paraphrased semantic prompt injection without override phrases is not caught by static preflight text checks.
- `ToolExecutor` and `DisproofCritic` ship as `@alchemy.run/domain` `ExternalSystem` contracts; no concrete subprocess/Docker runner or live LLM critic is bundled in `src/`.
- `test/Parity.test.ts` checks 57/57 `agent-admit` corpus parity against a sibling checkout at `../agent-admit/eval/corpus.json` (and imports `../tether/src/tether.ts` when present, falling back to an embedded reference otherwise).
- Cloudflare Worker hosting is scaffolded and tested fail-closed locally, not deployed.
