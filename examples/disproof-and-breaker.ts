import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { DisproofCritic } from "../src/DisproofCritic.external.ts";
import { TrustHarnessApi } from "../src/Harness.api.ts";
import { HarnessHandlers, TrustHarness } from "../src/Harness.model.ts";
import { BreakerRunId, CallId, TurnId, type BoundaryName } from "../src/ids.ts";
import type { ObserveInput } from "../src/schemas.ts";
import { ToolExecutor } from "../src/ToolExecutor.external.ts";
import { WasmJudgeLive } from "../src/wasm/live.ts";
import { loadPinnedBoundary, type JudgeHandle } from "../src/wasm/loader.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");

type AttackSpec = {
  id: string;
  boundary: BoundaryName;
  category: string;
  input: unknown;
};

const waitClosed = (turnId: TurnId, timeoutMs = 4000) =>
  Effect.gen(function* () {
    const client = yield* TrustHarnessApi.clientInProcess;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const receipt = yield* client.TurnReceipt.get(turnId);
      if (receipt && receipt.outcome !== "pending") return receipt;
      yield* Effect.sleep("10 millis");
    }
    throw new Error(`turn ${turnId} did not close in ${timeoutMs}ms`);
  });

const waitBreakerFinished = (runId: BreakerRunId, timeoutMs = 4000) =>
  Effect.gen(function* () {
    const client = yield* TrustHarnessApi.clientInProcess;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const report = yield* client.BreakerReport.get(runId);
      if (report && report.status === "finished") return report;
      yield* Effect.sleep("10 millis");
    }
    throw new Error(`breaker run ${runId} did not finish in ${timeoutMs}ms`);
  });

const executor = ToolExecutor.toLayer(
  Effect.succeed({
    execute: () =>
      Effect.succeed({
        service: "test-runner",
        http_status: 200,
        claimed_success: true,
        observed_proof: true,
        terminal_fault: "none",
        retrieval_authority: "none",
        retrieved_text: "test output captured",
      } satisfies ObserveInput),
  }),
);

const disprovingCritic = DisproofCritic.toLayer(
  Effect.succeed({
    challenge: () =>
      Effect.succeed({
        foundCounterexample: true,
        summary: "raw log shows 11 tests passed, not 12",
        counterexampleFields: [{ id: "tests_passed", claimed: "12", found: "11", anchored: true }],
      }),
  }),
);

const world = TrustHarness.layer(HarnessHandlers).pipe(
  Layer.provide(Layer.mergeAll(WasmJudgeLive, executor, disprovingCritic, Domain.InMemory)),
  Layer.provideMerge(Logger.layer([])),
);

const program = Effect.gen(function* () {
  const client = yield* TrustHarnessApi.clientInProcess;

  const turnId = TurnId.make("disproof-demo");
  yield* client.SubmitTurn(turnId, {
    preflight: {
      max_total_bytes: 2048,
      max_part_bytes: 512,
      parts: [{ id: "u1", kind: "text", source: "user", text: "run suite and report count" }],
    },
    toolCalls: [{ callId: CallId.make("c1"), action: { kind: "bash", command: "npm test" } }],
    verdict: {
      fields: [{ id: "tests_passed", claimed: "12", found: "12", anchored: true }],
    },
  });
  const turnReceipt = yield* waitClosed(turnId);

  const attacks = JSON.parse(readFileSync(path.join(root, "eval/breaker-attacks.json"), "utf8")) as AttackSpec[];
  const cache = new Map<BoundaryName, JudgeHandle>();
  const runId = BreakerRunId.make("example-breaker-round");
  yield* client.StartBreakerRound(runId, { round: 2 });

  for (const attack of attacks) {
    let handle = cache.get(attack.boundary);
    if (!handle) {
      const loaded = loadPinnedBoundary(distDir, attack.boundary);
      if (!loaded.ok) throw new Error(loaded.error.reason);
      handle = loaded.handle;
      cache.set(attack.boundary, handle);
    }
    const reply = handle.evalJson(attack.input) as { allow?: boolean; action?: string; reason?: string };
    const actualAllowed = attack.boundary === "verdict" ? reply.action === "pass" : reply.allow === true;
    yield* client.RecordAttack(runId, {
      attackId: attack.id,
      boundary: attack.boundary,
      actualAllowed,
      reason: String(reply.reason ?? reply.action ?? ""),
      wasmSha256: handle.sha256,
    });
  }
  yield* client.FinishBreakerRound(runId, {});
  const breakerReport = yield* waitBreakerFinished(runId);

  console.log(
    JSON.stringify(
      {
        disproofChallenge: {
          outcome: turnReceipt.outcome,
          blockedAt: turnReceipt.blockedAt,
          blockedReason: turnReceipt.blockedReason,
        },
        breakerRound: {
          totalAttacks: breakerReport?.totalAttacks ?? 0,
          caught: breakerReport?.caught ?? 0,
          disproofs: breakerReport?.disproofCount ?? 0,
        },
      },
      null,
      2,
    ),
  );
}).pipe(Effect.provide(world), Effect.scoped);

await Effect.runPromise(program);
