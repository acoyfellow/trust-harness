import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "@effect/vitest";
import { loadPinnedBoundary } from "../src/wasm/loader.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.env.TRUST_DIST_DIR ? path.resolve(process.env.TRUST_DIST_DIR) : path.join(root, "dist");
const admitCorpusPath = path.resolve(root, "../agent-admit/eval/corpus.json");
const tetherPath = path.resolve(root, "../tether/src/tether.ts");

type AdmitCorpusCase = {
  name: string;
  expect: boolean;
  reasonContains: string;
  action: Record<string, unknown>;
};

type AdmitCorpus = {
  policy: Record<string, unknown>;
  cases: AdmitCorpusCase[];
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/\/+$/, "");

const agrees = (claimed: string, found: string) => {
  const a = normalize(claimed);
  const b = normalize(found);
  return a === b || (a.length >= 7 && b.startsWith(a)) || (b.length >= 7 && a.startsWith(b));
};

const referenceStatusOf = (claimed: string | null, found: string | null) => {
  if (claimed === null) return "unclaimed";
  if (found === null) return "unbacked";
  return agrees(claimed, found) ? "held" : "broken";
};

it("admit.wasm matches 57/57 cases of agent-admit/eval/corpus.json (allow and reason)", () => {
  expect(existsSync(admitCorpusPath)).toBe(true);
  const corpus = JSON.parse(readFileSync(admitCorpusPath, "utf8")) as AdmitCorpus;
  expect(corpus.cases.length).toBe(57);

  const loaded = loadPinnedBoundary(distDir, "admit");
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;

  const policyJson = JSON.stringify(corpus.policy);
  const failures: Array<{ name: string; expected: boolean; got: unknown }> = [];

  for (const item of corpus.cases) {
    const action =
      item.action.kind === "lockfile" && item.action.policyJson === "__POLICY__"
        ? { ...item.action, policyJson }
        : item.action;
    const reply = loaded.handle.evalJson(action) as { allow?: boolean; reason?: string };
    const allowMatch = reply.allow === item.expect;
    const reasonMatch =
      typeof reply.reason === "string" &&
      reply.reason.toLowerCase().includes(item.reasonContains.toLowerCase());
    if (!allowMatch || !reasonMatch) {
      failures.push({ name: item.name, expected: item.expect, got: reply });
    }
  }

  expect(failures).toEqual([]);
});

it("verdict.wasm matches 578/578 claim/evidence pairs against tether statusOf", async () => {
  const loaded = loadPinnedBoundary(distDir, "verdict");
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;

  let statusFn: (claimed: string | null, found: string | null) => string = referenceStatusOf;
  if (existsSync(tetherPath)) {
    const tetherMod = (await import(tetherPath)) as {
      statusOf: (
        claim: { value: string | null; span: null; confidence: number },
        evidence: { value: string | null; span: null; confidence: number },
      ) => string;
    };
    statusFn = (claimed, found) =>
      tetherMod.statusOf(
        { value: claimed, span: null, confidence: 1 },
        { value: found, span: null, confidence: 1 },
      );
  }

  const values = [
    null,
    "",
    " ",
    "12",
    "1",
    "12 ",
    "a04a587",
    "a04a5871c2",
    "a04a58",
    "https://x.dev/",
    "https://X.dev",
    "v1.2.3",
    "V1.2.3//",
    "0",
    "-1",
    "é",
    "É",
  ];

  const cases = values.flatMap((claimed) =>
    values.flatMap((found) => [true, false].map((anchored) => ({ id: "x", claimed, found, anchored }))),
  );
  expect(cases.length).toBe(578);

  const mismatches = cases.filter((field) => {
    const expected = statusFn(field.claimed, field.anchored ? field.found : null);
    const ruling = loaded.handle.evalJson({ fields: [field] }) as {
      error?: string;
      lines?: Array<{ status: string }>;
    };
    return Boolean(ruling.error) || ruling.lines?.[0]?.status !== expected;
  });

  expect(mismatches).toEqual([]);
});
