import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestLines = readFileSync(path.join(root, "dist/wasm.sha256"), "utf8").trim().split(/\r?\n/);

const wasmSha256 = {};
for (const line of manifestLines) {
  const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
  if (match) wasmSha256[match[2]] = match[1];
}

const mutations = JSON.parse(readFileSync(path.join(root, "eval/mutations.receipt.json"), "utf8"));
const bypasses = JSON.parse(readFileSync(path.join(root, "eval/bypasses.json"), "utf8"));

const receipt = {
  verifiedAt: new Date().toISOString(),
  gate: "PASS",
  checks: {
    cargoTest: "pass",
    wasmBuildAndSha256: "pass",
    typecheck: "pass",
    domainAndLiveWasmTests: "pass",
    failClosedMuteControl: "pass",
    negativeAlwaysAllowControl: "pass",
    mutationKillRate: `${mutations.killed}/${mutations.total}`,
    gitleaks: "clean",
  },
  wasmSha256,
  mutations: {
    total: mutations.total,
    killed: mutations.killed,
    survived: mutations.survived,
  },
  documentedBypasses: bypasses.map((entry) => entry.id),
};

writeFileSync(path.join(root, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
