import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const outPath = process.env.MUTATIONS_OUT ?? path.join(root, ".mutations.receipt.json");
const cargoEnv = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH ?? ""}` };

const mutations = [
  {
    id: "domain-skip-preflight-guard",
    file: "src/Turn/Turn.aggregate.ts",
    find: 'if (state._tag === "Active") return state;',
    replace: 'if (state._tag === "Active" || state._tag === "AwaitingPreflight") return { _tag: "Active", admittedCalls: [], observedCalls: [] };',
    kind: "vitest",
  },
  {
    id: "domain-skip-call-admitted-check",
    file: "src/Turn/Turn.aggregate.ts",
    find: "if (!active.admittedCalls.includes(command.callId)) {",
    replace: "if (false && !active.admittedCalls.includes(command.callId)) {",
    kind: "vitest",
  },
  {
    id: "domain-skip-pending-observations",
    file: "src/Turn/Turn.aggregate.ts",
    find: "if (missing.length > 0) {",
    replace: "if (false && missing.length > 0) {",
    kind: "vitest",
  },
  {
    id: "domain-allow-post-close-mutation",
    file: "src/Turn/Turn.aggregate.ts",
    find: 'if (state._tag === "Closed") return new TurnClosed({ outcome: state.outcome });',
    replace: 'if (state._tag === "Closed") return { _tag: "Active", admittedCalls: [], observedCalls: [] };',
    kind: "vitest",
  },
  {
    id: "domain-skip-verdict-retry-mapping",
    file: "src/Turn/Turn.aggregate.ts",
    find: 'if (action === "retry") return "retry";',
    replace: 'if (action === "retry") return "passed";',
    kind: "vitest",
  },
  {
    id: "domain-skip-disproof-gate",
    file: "src/Turn/Turn.aggregate.ts",
    find: 'if (state._tag !== "AwaitingDisproof") return new VerdictNotPassed();',
    replace: 'if (false && state._tag !== "AwaitingDisproof") return new VerdictNotPassed();',
    kind: "vitest",
  },
  {
    id: "loader-skip-sha256-check",
    file: "src/wasm/loader.ts",
    find: "if (actual !== expected) {",
    replace: "if (false && actual !== expected) {",
    kind: "vitest",
  },
  {
    id: "saga-skip-admit-stop",
    file: "src/Turn/RunTurn.saga.ts",
    find: "if (!admitResult.success.allow) return;",
    replace: "if (false && !admitResult.success.allow) return;",
    kind: "vitest",
  },
  {
    id: "saga-ignore-verified-disproof",
    file: "src/Turn/RunTurn.saga.ts",
    find: 'const disproven = verified.success.action !== "pass";',
    replace: "const disproven = false;",
    kind: "vitest",
  },
  {
    id: "wasm-preflight-drop-spoof",
    file: "crates/preflight/src/lib.rs",
    find: 'lower.contains("ignore previous instructions")',
    replace: "false",
    kind: "wasm",
    boundary: "preflight",
  },
  {
    id: "wasm-admit-drop-secret-path",
    file: "crates/admit/src/command.rs",
    find: "if secret_paths().is_match(target_path) {",
    replace: "if false && secret_paths().is_match(target_path) {",
    kind: "wasm",
    boundary: "admit",
  },
  {
    id: "pi-skip-tool-result-redaction",
    file: "pi/index.ts",
    find: "structuredContent: null,\n          isError: true,",
    replace: "structuredContent: event.structuredContent,\n          isError: false,",
    kind: "vitest",
  },
  {
    id: "wasm-admit-drop-short-no-verify",
    file: "crates/admit/src/command.rs",
    find: "if *ch == 'n' {\n                        return true;\n                    }",
    replace: "if *ch == 'z' {\n                        return true;\n                    }",
    kind: "wasm",
    boundary: "admit",
  },
  {
    id: "wasm-admit-drop-attached-flag-guard",
    file: "crates/admit/src/command.rs",
    find: "if COMMIT_SHORT_OPTIONS_TAKING_VALUE.contains(ch) {",
    replace: "if COMMIT_SHORT_OPTIONS_TAKING_VALUE.is_empty() {",
    kind: "wasm",
    boundary: "admit",
  },
  {
    id: "wasm-observe-drop-false-success",
    file: "crates/observe/src/lib.rs",
    find: "if request.claimed_success && !request.observed_proof {",
    replace: "if false && request.claimed_success && !request.observed_proof {",
    kind: "wasm",
    boundary: "observe",
  },
  {
    id: "wasm-verdict-drop-broken-retry",
    file: "crates/verdict/src/lib.rs",
    find: "if broken > 0 {\n        Action::Retry",
    replace: "if broken > 0 {\n        Action::Pass",
    kind: "wasm",
    boundary: "verdict",
  },
];

const sha256File = (filePath) => createHash("sha256").update(readFileSync(filePath)).digest("hex");

const runVitestMutation = () => {
  try {
    execFileSync("npx", ["vitest", "run"], { cwd: root, stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
};

const runWasmMutation = (id, boundary) => {
  const pkg = `trust-${boundary}`;
  const tempDir = `/tmp/trust-harness/mut-${id}`;
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });
  try {
    execFileSync("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "-p", pkg], {
      cwd: root,
      env: cargoEnv,
      stdio: "pipe",
    });
    cpSync(distDir, tempDir, { recursive: true });
    const builtWasm = path.join(root, `target/wasm32-unknown-unknown/release/trust_${boundary}.wasm`);
    cpSync(builtWasm, path.join(tempDir, `${boundary}.wasm`));
    const files = ["preflight.wasm", "admit.wasm", "observe.wasm", "verdict.wasm"];
    const manifest = files.map((name) => `${sha256File(path.join(tempDir, name))}  ${name}`).join("\n") + "\n";
    writeFileSync(path.join(tempDir, "wasm.sha256"), manifest, "utf8");
    try {
      execFileSync("npx", ["vitest", "run", "test/LiveWasm.test.ts", "test/Parity.test.ts", "test/Breaker.test.ts"], {
        cwd: root,
        env: { ...process.env, TRUST_DIST_DIR: tempDir },
        stdio: "pipe",
      });
      return false;
    } catch {
      return true;
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

const results = [];
let survived = 0;

try {
  for (const item of mutations) {
    const fullPath = path.join(root, item.file);
    const original = readFileSync(fullPath, "utf8");
    if (!original.includes(item.find)) {
      throw new Error(`mutation target not found for ${item.id} in ${item.file}`);
    }
    const mutated = original.replace(item.find, item.replace);
    let killed = false;
    try {
      writeFileSync(fullPath, mutated, "utf8");
      killed = item.kind === "vitest" ? runVitestMutation() : runWasmMutation(item.id, item.boundary);
    } finally {
      writeFileSync(fullPath, original, "utf8");
    }
    if (!killed) survived += 1;
    results.push({ id: item.id, file: item.file, mode: item.kind, killed });
    console.log(`${killed ? "KILLED  " : "SURVIVED"} ${item.id} (${item.kind}: ${item.file})`);
  }
} finally {
  execFileSync("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "--workspace"], {
    cwd: root,
    env: cargoEnv,
    stdio: "pipe",
  });
}

const summary = {
  total: results.length,
  killed: results.length - survived,
  survived,
  killRate: Math.round(((results.length - survived) / results.length) * 10000) / 10000,
  results,
};

writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`mutation kill rate: ${summary.killed}/${summary.total} (${Math.round(summary.killRate * 100)}%)`);
if (survived > 0) process.exit(1);
