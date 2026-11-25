import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Activity } from "effect/workflow";
import { CriticUnavailable, DisproofCritic } from "../DisproofCritic.external.ts";
import { TurnId } from "../ids.ts";
import {
  AdmitOutput,
  DisproofProposal,
  ObserveInput,
  ObserveOutput,
  PlannedToolCall,
  PreflightInput,
  PreflightOutput,
  VerdictInput,
  VerdictOutput,
} from "../schemas.ts";
import { ToolExecutionFailed, ToolExecutor } from "../ToolExecutor.external.ts";
import { WasmJudge, WasmJudgeUnavailable } from "../WasmJudge.external.ts";
import { ApplyDisproof } from "./ApplyDisproof.command.ts";
import { ApplyObservation } from "./ApplyObservation.command.ts";
import { ApplyPreflight } from "./ApplyPreflight.command.ts";
import { ApplyToolAdmit } from "./ApplyToolAdmit.command.ts";
import { ApplyVerdict } from "./ApplyVerdict.command.ts";
import { BlockTurn } from "./BlockTurn.command.ts";
import { Turn } from "./Turn.aggregate.ts";

export class RunTurn extends Domain.Saga(
  "RunTurn",
  {
    key: TurnId,
    input: {
      preflight: PreflightInput,
      toolCalls: Schema.Array(PlannedToolCall),
      verdict: VerdictInput,
    },
  },
  { description: "Runs a turn through preflight, admit, live tool execution, observe, verdict, and disproof challenge." },
) {}

export const RunTurnLive = RunTurn.toLayer(
  Effect.gen(function* () {
    const turns = yield* Turn;
    const judge = yield* WasmJudge;
    const executor = yield* ToolExecutor;
    const critic = yield* DisproofCritic;

    return Effect.fn(function* ({ key, preflight, toolCalls, verdict }) {
      const preflightResult = yield* Activity.make({
        name: "boundary-1-preflight",
        success: PreflightOutput,
        error: WasmJudgeUnavailable,
        execute: judge.preflight({ input: preflight }),
      }).pipe(Effect.result);

      if (preflightResult._tag === "Failure") {
        yield* Activity.make({
          name: "block-preflight-unavailable",
          execute: turns
            .send(
              key,
              new BlockTurn({
                boundary: "preflight",
                reason: preflightResult.failure.reason,
              }),
            )
            .pipe(Effect.catchTag("TurnClosed", () => Effect.void), Effect.asVoid),
        });
        return;
      }

      yield* Activity.make({
        name: "record-preflight",
        execute: turns.send(key, new ApplyPreflight({ decision: preflightResult.success })).pipe(Effect.orDie),
      });

      if (!preflightResult.success.allow) return;

      for (const call of toolCalls) {
        const admitResult = yield* Activity.make({
          name: `boundary-2-admit-${call.callId}`,
          success: AdmitOutput,
          error: WasmJudgeUnavailable,
          execute: judge.admit({ action: call.action }),
        }).pipe(Effect.result);

        if (admitResult._tag === "Failure") {
          yield* Activity.make({
            name: `block-admit-unavailable-${call.callId}`,
            execute: turns
              .send(
                key,
                new BlockTurn({
                  boundary: "admit",
                  reason: admitResult.failure.reason,
                }),
              )
              .pipe(Effect.catchTag("TurnClosed", () => Effect.void), Effect.asVoid),
          });
          return;
        }

        yield* Activity.make({
          name: `record-admit-${call.callId}`,
          execute: turns
            .send(
              key,
              new ApplyToolAdmit({
                callId: call.callId,
                toolKind: call.action.kind,
                decision: admitResult.success,
              }),
            )
            .pipe(Effect.orDie),
        });

        if (!admitResult.success.allow) return;

        const executed = yield* Activity.make({
          name: `execute-tool-${call.callId}`,
          success: ObserveInput,
          error: ToolExecutionFailed,
          execute: executor.execute({ callId: call.callId, action: call.action }),
        }).pipe(Effect.result);

        const observedInput: ObserveInput =
          executed._tag === "Success"
            ? executed.success
            : {
                service: call.action.kind,
                http_status: 500,
                claimed_success: false,
                observed_proof: false,
                terminal_fault: "execution-error",
                retrieval_authority: "none",
                retrieved_text: executed.failure.reason,
              };

        const observeResult = yield* Activity.make({
          name: `boundary-3-observe-${call.callId}`,
          success: ObserveOutput,
          error: WasmJudgeUnavailable,
          execute: judge.observe({ input: observedInput }),
        }).pipe(Effect.result);

        if (observeResult._tag === "Failure") {
          yield* Activity.make({
            name: `block-observe-unavailable-${call.callId}`,
            execute: turns
              .send(
                key,
                new BlockTurn({
                  boundary: "observe",
                  reason: observeResult.failure.reason,
                }),
              )
              .pipe(Effect.catchTag("TurnClosed", () => Effect.void), Effect.asVoid),
          });
          return;
        }

        yield* Activity.make({
          name: `record-observe-${call.callId}`,
          execute: turns
            .send(
              key,
              new ApplyObservation({
                callId: call.callId,
                decision: observeResult.success,
              }),
            )
            .pipe(Effect.orDie),
        });

        if (!observeResult.success.allow) return;
      }

      const verdictResult = yield* Activity.make({
        name: "boundary-4-verdict",
        success: VerdictOutput,
        error: WasmJudgeUnavailable,
        execute: judge.verdict({ input: verdict }),
      }).pipe(Effect.result);

      if (verdictResult._tag === "Failure") {
        yield* Activity.make({
          name: "block-verdict-unavailable",
          execute: turns
            .send(
              key,
              new BlockTurn({
                boundary: "verdict",
                reason: verdictResult.failure.reason,
              }),
            )
            .pipe(Effect.catchTag("TurnClosed", () => Effect.void), Effect.asVoid),
        });
        return;
      }

      yield* Activity.make({
        name: "record-verdict",
        execute: turns.send(key, new ApplyVerdict({ decision: verdictResult.success })).pipe(Effect.orDie),
      });

      if (verdictResult.success.action !== "pass") return;

      const challengeResult = yield* Activity.make({
        name: "disproof-challenge",
        success: DisproofProposal,
        error: CriticUnavailable,
        execute: critic.challenge({ turnId: key, verdict }),
      }).pipe(Effect.result);

      if (challengeResult._tag === "Failure") {
        yield* Activity.make({
          name: "block-critic-unavailable",
          execute: turns
            .send(
              key,
              new BlockTurn({
                boundary: "verdict",
                reason: `disproof critic unavailable: ${challengeResult.failure.reason}`,
              }),
            )
            .pipe(Effect.catchTag("TurnClosed", () => Effect.void), Effect.asVoid),
        });
        return;
      }

      const proposal = challengeResult.success;
      if (proposal.foundCounterexample && proposal.counterexampleFields.length > 0) {
        const verified = yield* Activity.make({
          name: "verify-disproof-counterexample",
          success: VerdictOutput,
          error: WasmJudgeUnavailable,
          execute: judge.verdict({ input: { fields: proposal.counterexampleFields } }),
        }).pipe(Effect.result);

        if (verified._tag === "Failure") {
          yield* Activity.make({
            name: "block-disproof-verify-unavailable",
            execute: turns
              .send(
                key,
                new BlockTurn({
                  boundary: "verdict",
                  reason: verified.failure.reason,
                }),
              )
              .pipe(Effect.catchTag("TurnClosed", () => Effect.void), Effect.asVoid),
          });
          return;
        }

        const disproven = verified.success.action !== "pass";
        yield* Activity.make({
          name: "record-disproof-verified",
          execute: turns
            .send(
              key,
              new ApplyDisproof({
                disproven,
                summary: disproven
                  ? proposal.summary
                  : `critic counterexample refuted by verdict.wasm: ${proposal.summary}`,
                wasmSha256: verified.success.wasmSha256,
              }),
            )
            .pipe(Effect.orDie),
        });
        return;
      }

      yield* Activity.make({
        name: "record-disproof-failed",
        execute: turns
          .send(
            key,
            new ApplyDisproof({
              disproven: false,
              summary: proposal.summary,
              wasmSha256: verdictResult.success.wasmSha256,
            }),
          )
          .pipe(Effect.orDie),
      });
    });
  }),
);
