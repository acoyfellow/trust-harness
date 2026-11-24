import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cargoEnv = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH ?? ""}` };

const mutations = [
  {
    id: "domain-skip-preflight-guard",
    file: "src/Turn/Turn.aggregate.ts",
    find: 'if (state._tag === "Active") return state;',
    replace: 'if (state._tag === "Active" || state._tag === "AwaitingPreflight") return { _tag: "Active", admittedCalls: [], observedCalls: [] };',
    runner: "vitest",
  },
  {
    id: "domain-skip-call-admitted-check",
    file: "src/Turn/Turn.aggregate.ts",
    find: "if (!active.admittedCalls.includes(command.callId)) {",
    replace: "if (false && !active.admittedCalls.includes(command.callId)) {",
    runner: "vitest",
  },
  {
    id: "domain-skip-pending-observations",
    file: "src/Turn/Turn.aggregate.ts",
    find: "if (missing.length > 0) {",
    replace: "if (false && missing.length > 0) {",
    runner: "vitest",
  },
  {
    id: "domain-allow-post-close-mutation",
    file: "src/Turn/Turn.aggregate.ts",
    find: 'if (state._tag === "Closed") return new TurnClosed({ outcome: state.outcome });',
    replace: 'if (state._tag === "Closed") return { _tag: "Active", admittedCalls: [], observedCalls: [] };',
    runner: "vitest",
  },
  {
    id: "domain-skip-verdict-retry-mapping",
    file: "src/Turn/Turn.aggregate.ts",
    find: 'if (action === "retry") return "retry";',
    replace: 'if (action === "retry") return "passed";',
    runner: "vitest",
  },
  {
    id: "loader-skip-sha256-check",
    file: "src/wasm/loader.ts",
    find: "if (actual !== expected) {",
    replace: "if (false && actual !== expected) {",
    runner: "vitest",
  },
  {
    id: "saga-skip-admit-stop",
    file: "src/Turn/RunTurn.saga.ts",
    find: "if (!admitResult.success.allow) return;",
    replace: "if (false && !admitResult.success.allow) return;",
    runner: "vitest",
  },
  {
    id: "rust-preflight-drop-spoof",
    file: "crates/preflight/src/lib.rs",
    find: 'lower.contains("ignore previous instructions")',
    replace: "false",
    runner: "cargo-preflight",
  },
  {
    id: "rust-admit-drop-env-deny",
    file: "crates/admit/src/lib.rs",
    find: 'base == ".env"',
    replace: "false",
    runner: "cargo-admit",
  },
  {
    id: "rust-observe-drop-false-success",
    file: "crates/observe/src/lib.rs",
    find: "if request.claimed_success && !request.observed_proof {",
    replace: "if false && request.claimed_success && !request.observed_proof {",
    runner: "cargo-observe",
  },
  {
    id: "rust-verdict-drop-broken-retry",
    file: "crates/verdict/src/lib.rs",
    find: "if broken > 0 {\n        Action::Retry",
    replace: "if broken > 0 {\n        Action::Pass",
    runner: "cargo-verdict",
  },
];

const runSuite = (runner) => {
  try {
    if (runner === "vitest") {
      execFileSync("npx", ["vitest", "run"], { cwd: root, stdio: "pipe" });
    } else {
      const pkg = `trust-${runner.replace("cargo-", "")}`;
      execFileSync("cargo", ["test", "-p", pkg], { cwd: root, env: cargoEnv, stdio: "pipe" });
    }
    return false;
  } catch {
    return true;
  }
};

const results = [];
let survived = 0;

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
    killed = runSuite(item.runner);
  } finally {
    writeFileSync(fullPath, original, "utf8");
  }
  if (!killed) survived += 1;
  results.push({ id: item.id, file: item.file, runner: item.runner, killed });
  console.log(`${killed ? "KILLED  " : "SURVIVED"} ${item.id} (${item.file})`);
}

const summary = {
  total: results.length,
  killed: results.length - survived,
  survived,
  killRate: Math.round(((results.length - survived) / results.length) * 10000) / 10000,
  results,
};

writeFileSync(path.join(root, "eval/mutations.receipt.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`mutation kill rate: ${summary.killed}/${summary.total} (${Math.round(summary.killRate * 100)}%)`);
if (survived > 0) process.exit(1);
