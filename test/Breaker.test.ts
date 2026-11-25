import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Domain from "@alchemy.run/domain";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { DisproofCritic } from "../src/DisproofCritic.external.ts";
import { TrustHarnessApi } from "../src/Harness.api.ts";
import { HarnessHandlers, TrustHarness } from "../src/Harness.model.ts";
import { BreakerRunId, type BoundaryName } from "../src/ids.ts";
import { ToolExecutor } from "../src/ToolExecutor.external.ts";
import { WasmJudgeLive } from "../src/wasm/live.ts";
import { loadPinnedBoundary, type JudgeHandle } from "../src/wasm/loader.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.env.TRUST_DIST_DIR ? path.resolve(process.env.TRUST_DIST_DIR) : path.join(root, "dist");

type AttackSpec = {
  id: string;
  boundary: BoundaryName;
  category: string;
  input: unknown;
};

const unusedExecutor = ToolExecutor.toLayer(Effect.succeed({ execute: () => Effect.never }));
const unusedCritic = DisproofCritic.toLayer(Effect.succeed({ challenge: () => Effect.never }));

const World = TrustHarness.layer(HarnessHandlers).pipe(
  Layer.provide(Layer.mergeAll(WasmJudgeLive, unusedExecutor, unusedCritic, Domain.InMemory)),
);

it.live("Maker vs Breaker: Round 1 found 5 real disproofs and Round 2 closes all 5 through BreakerRun Domain model", () =>
  Effect.gen(function* () {
    const round1 = JSON.parse(readFileSync(path.join(root, "eval/breaker-round1.json"), "utf8")) as {
      disproofCount: number;
      disproofIds: string[];
    };
    expect(round1.disproofCount).toBe(5);
    expect(round1.disproofIds).toContain("admit-git-commit-short-no-verify");
    expect(round1.disproofIds).toContain("preflight-whitespace-spoof");
    expect(round1.disproofIds).toContain("observe-whitespace-hostile");

    const attacks = JSON.parse(readFileSync(path.join(root, "eval/breaker-attacks.json"), "utf8")) as AttackSpec[];
    const cache = new Map<BoundaryName, JudgeHandle>();
    const client = yield* TrustHarnessApi.clientInProcess;
    const runId = BreakerRunId.make("round-2");

    yield* client.StartBreakerRound(runId, { round: 2 });

    for (const attack of attacks) {
      let handle = cache.get(attack.boundary);
      if (!handle) {
        const loaded = loadPinnedBoundary(distDir, attack.boundary);
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;
        handle = loaded.handle;
        cache.set(attack.boundary, handle);
      }
      const reply = handle.evalJson(attack.input) as { allow?: boolean; action?: string; reason?: string };
      const actualAllowed = attack.boundary === "verdict" ? reply.action === "pass" : reply.allow === true;
      yield* client.RecordAttack(runId, {
        attackId: attack.id,
        boundary: attack.boundary,
        actualAllowed,
        wasmSha256: handle.sha256,
        reason: String(reply.reason ?? reply.action ?? "ruled"),
      });
    }

    const dup = yield* client
      .RecordAttack(runId, {
        attackId: attacks[0].id,
        boundary: attacks[0].boundary,
        actualAllowed: false,
        wasmSha256: "x",
        reason: "dup",
      })
      .pipe(Effect.flip);
    expect(dup._tag).toBe("DuplicateAttackId");

    const receipt = yield* client.FinishBreakerRound(runId, {});
    const report = yield* client.BreakerReport.get(runId, { atLeast: receipt });

    expect(report?.status).toBe("finished");
    expect(report?.round).toBe(2);
    expect(report?.totalAttacks).toBe(attacks.length);
    expect(report?.caught).toBe(attacks.length);
    expect(report?.disproofCount).toBe(0);
    expect(report?.disproofs).toEqual([]);

    const afterFinish = yield* client
      .RecordAttack(runId, {
        attackId: "late-attack",
        boundary: "admit",
        actualAllowed: false,
        wasmSha256: "x",
        reason: "late",
      })
      .pipe(Effect.flip);
    expect(afterFinish._tag).toBe("RoundNotRunning");
  }).pipe(Effect.scoped, Effect.provide(World)),
);
