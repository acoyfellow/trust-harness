import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPinnedBoundary } from "../src/wasm/loader.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.env.TRUST_DIST_DIR ? path.resolve(process.env.TRUST_DIST_DIR) : path.join(root, "dist");
const outPath = process.argv[2];

const attacks = JSON.parse(readFileSync(path.join(root, "eval/breaker-attacks.json"), "utf8"));
const cache = new Map();
const results = [];

for (const attack of attacks) {
  let handle = cache.get(attack.boundary);
  if (!handle) {
    const loaded = loadPinnedBoundary(distDir, attack.boundary);
    if (!loaded.ok) throw new Error(loaded.error.reason);
    handle = loaded.handle;
    cache.set(attack.boundary, handle);
  }
  const reply = handle.evalJson(attack.input);
  const actualAllowed = attack.boundary === "verdict" ? reply.action === "pass" : reply.allow === true;
  results.push({
    attackId: attack.id,
    boundary: attack.boundary,
    category: attack.category,
    caught: !actualAllowed,
    disproof: actualAllowed,
    wasmSha256: handle.sha256,
    reply,
  });
}

const disproofs = results.filter((row) => row.disproof);
const summary = {
  ranAt: new Date().toISOString(),
  totalAttacks: results.length,
  caught: results.length - disproofs.length,
  disproofCount: disproofs.length,
  disproofIds: disproofs.map((row) => row.attackId),
  results,
};

if (outPath) {
  writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
}
console.log(JSON.stringify({ totalAttacks: summary.totalAttacks, caught: summary.caught, disproofCount: summary.disproofCount, disproofIds: summary.disproofIds }, null, 2));
