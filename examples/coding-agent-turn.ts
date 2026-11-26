import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { DisproofCritic } from "../src/DisproofCritic.external.ts";
import { TrustHarnessApi } from "../src/Harness.api.ts";
import { HarnessHandlers, TrustHarness } from "../src/Harness.model.ts";
import { CallId, TurnId } from "../src/ids.ts";
import type { AdmitAction, ObserveInput } from "../src/schemas.ts";
import { ToolExecutor } from "../src/ToolExecutor.external.ts";
import type { TurnReceiptState } from "../src/TurnReceipt.view.ts";
import { WasmJudgeLive } from "../src/wasm/live.ts";

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

const runCase = (id: string, action: AdmitAction) =>
  Effect.gen(function* () {
    let executedCalls = 0;
    const executor = ToolExecutor.toLayer(
      Effect.succeed({
        execute: () =>
          Effect.sync(() => {
            executedCalls += 1;
            const observation: ObserveInput = {
              service: "local-shell",
              http_status: 200,
              claimed_success: true,
              observed_proof: true,
              terminal_fault: "none",
              retrieval_authority: "none",
              retrieved_text: "command completed with exit 0",
            };
            return observation;
          }),
      }),
    );

    const critic = DisproofCritic.toLayer(
      Effect.succeed({
        challenge: () =>
          Effect.succeed({
            foundCounterexample: false,
            summary: "no counterexample found",
            counterexampleFields: [],
          }),
      }),
    );

    const world = TrustHarness.layer(HarnessHandlers).pipe(
      Layer.provide(Layer.mergeAll(WasmJudgeLive, executor, critic, Domain.InMemory)),
      Layer.provideMerge(Logger.layer([])),
    );

    const receipt: TurnReceiptState = yield* Effect.gen(function* () {
      const client = yield* TrustHarnessApi.clientInProcess;
      const turnId = TurnId.make(id);
      yield* client.SubmitTurn(turnId, {
        preflight: {
          max_total_bytes: 2048,
          max_part_bytes: 512,
          parts: [{ id: "u1", kind: "text", source: "user", text: "commit verified fix" }],
        },
        toolCalls: [{ callId: CallId.make("c1"), action }],
        verdict: {
          fields: [{ id: "tests_passed", claimed: "23", found: "23", anchored: true }],
        },
      });
      return yield* waitClosed(turnId);
    }).pipe(Effect.provide(world), Effect.scoped);

    return {
      id,
      executedCalls,
      outcome: receipt.outcome,
      blockedAt: receipt.blockedAt,
      blockedReason: receipt.blockedReason,
    };
  });

const program = Effect.gen(function* () {
  const results = [
    yield* runCase("safe-attached-commit", {
      kind: "bash",
      command: 'git commit -m"don\'t break main"',
    }),
    yield* runCase("blocked-short-no-verify", {
      kind: "bash",
      command: "git commit -an -m bypass",
    }),
    yield* runCase("blocked-private-lockfile", {
      kind: "lockfile",
      text: '{"resolved":"https://npm.corp.acme.example/pkg/-/pkg-1.0.0.tgz"}',
    }),
  ];
  console.log(JSON.stringify(results, null, 2));
});

await Effect.runPromise(program);
