import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitestPath = process.argv[2];
const mutationsPath = process.argv[3];
const outPath = process.argv[4] ?? path.join(root, ".receipt.json");

if (!vitestPath || !mutationsPath) {
  throw new Error("usage: node scripts/write-receipt.mjs <vitest.json> <mutations.json> [out.json]");
}

const manifestLines = readFileSync(path.join(root, "dist/wasm.sha256"), "utf8").trim().split(/\r?\n/);
const wasmSha256 = {};
for (const line of manifestLines) {
  const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
  if (!match) continue;
  const [, expected, name] = match;
  const actual = createHash("sha256").update(readFileSync(path.join(root, "dist", name))).digest("hex");
  if (actual !== expected.toLowerCase()) {
    throw new Error(`sha256 mismatch while writing receipt for ${name}: ${actual} !== ${expected}`);
  }
  wasmSha256[name] = actual;
}

if (Object.keys(wasmSha256).length !== 4) {
  throw new Error(`expected 4 pinned wasm entries, got ${Object.keys(wasmSha256).length}`);
}

const vitest = JSON.parse(readFileSync(vitestPath, "utf8"));
if (!vitest.success || vitest.numFailedTests !== 0 || vitest.numPassedTests < 18) {
  throw new Error(`vitest did not pass cleanly: passed=${vitest.numPassedTests} failed=${vitest.numFailedTests}`);
}

const mutations = JSON.parse(readFileSync(mutationsPath, "utf8"));
if (mutations.survived !== 0 || mutations.killed !== mutations.total || mutations.total < 11) {
  throw new Error(`mutation check incomplete: killed=${mutations.killed}/${mutations.total} survived=${mutations.survived}`);
}

const testTitles = vitest.testResults.flatMap((suite) =>
  suite.assertionResults.filter((item) => item.status === "passed").map((item) => item.title),
);

const bypasses = JSON.parse(readFileSync(path.join(root, "eval/bypasses.json"), "utf8"));

const receipt = {
  verifiedAt: new Date().toISOString(),
  gate: "PASS",
  vitest: {
    passedFiles: vitest.numPassedTestSuites,
    failedFiles: vitest.numFailedTestSuites,
    passedTests: vitest.numPassedTests,
    failedTests: vitest.numFailedTests,
  },
  parity: {
    admitCorpus57: testTitles.some((title) => title.includes("57/57")),
    verdictTether578: testTitles.some((title) => title.includes("578/578")),
    tamperAll4Boundaries: testTitles.some((title) => title.includes("all 4 boundaries")),
  },
  wasmSha256,
  mutations: {
    total: mutations.total,
    killed: mutations.killed,
    survived: mutations.survived,
    modes: {
      vitest: mutations.results.filter((row) => row.mode === "vitest" && row.killed).length,
      wasm: mutations.results.filter((row) => row.mode === "wasm" && row.killed).length,
    },
  },
  documentedBypasses: bypasses.map((entry) => entry.id),
};

if (!receipt.parity.admitCorpus57 || !receipt.parity.verdictTether578 || !receipt.parity.tamperAll4Boundaries) {
  throw new Error(`required parity/control test missing from vitest output: ${JSON.stringify(receipt.parity)}`);
}

writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`);
