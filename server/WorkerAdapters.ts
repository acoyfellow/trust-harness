import * as Effect from "effect/Effect";
import { CriticUnavailable, DisproofCritic } from "../src/DisproofCritic.external.ts";
import { ToolExecutionFailed, ToolExecutor } from "../src/ToolExecutor.external.ts";
import { WasmJudge, WasmJudgeUnavailable } from "../src/WasmJudge.external.ts";

export const FailClosedWorkerJudge = WasmJudge.toLayer(
  Effect.succeed({
    preflight: () =>
      Effect.fail(
        new WasmJudgeUnavailable({
          boundary: "preflight",
          reason: "worker wasm module binding not configured",
        }),
      ),
    admit: () =>
      Effect.fail(
        new WasmJudgeUnavailable({
          boundary: "admit",
          reason: "worker wasm module binding not configured",
        }),
      ),
    observe: () =>
      Effect.fail(
        new WasmJudgeUnavailable({
          boundary: "observe",
          reason: "worker wasm module binding not configured",
        }),
      ),
    verdict: () =>
      Effect.fail(
        new WasmJudgeUnavailable({
          boundary: "verdict",
          reason: "worker wasm module binding not configured",
        }),
      ),
  }),
);

export const FailClosedWorkerExecutor = ToolExecutor.toLayer(
  Effect.succeed({
    execute: ({ callId }) =>
      Effect.fail(
        new ToolExecutionFailed({
          callId,
          reason: "worker tool executor requires isolated runner binding",
        }),
      ),
  }),
);

export const FailClosedWorkerCritic = DisproofCritic.toLayer(
  Effect.succeed({
    challenge: () =>
      Effect.fail(
        new CriticUnavailable({
          reason: "worker disproof critic requires configured verifier",
        }),
      ),
  }),
);
