import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { BreakerRunId } from "../ids.ts";
import { DuplicateAttackId, RoundAlreadyStarted, RoundNotRunning } from "./Breaker.rejections.ts";
import { BreakerRoundFinished, FinishBreakerRound } from "./FinishBreakerRound.command.ts";
import { AttackCaught, DisproofRecorded, RecordAttack } from "./RecordAttack.command.ts";
import { BreakerRoundStarted, StartBreakerRound } from "./StartBreakerRound.command.ts";

const BreakerState = Schema.Union([
  Schema.TaggedStruct("Idle", {}),
  Schema.TaggedStruct("Running", {
    round: Schema.Number,
    attackIds: Schema.Array(Schema.String),
    caught: Schema.Number,
    disproofCount: Schema.Number,
  }),
  Schema.TaggedStruct("Finished", {
    round: Schema.Number,
    totalAttacks: Schema.Number,
    caught: Schema.Number,
    disproofCount: Schema.Number,
  }),
]);
type BreakerState = typeof BreakerState.Type;

const iso = (now: DateTime.Utc) => DateTime.formatIso(now);

export class BreakerRun extends Domain.Aggregate(
  "BreakerRun",
  {
    id: BreakerRunId,
    state: BreakerState,
    initial: { _tag: "Idle" },
    commands: [StartBreakerRound, RecordAttack, FinishBreakerRound],
    decide: {
      StartBreakerRound: (state, command, { now }) =>
        state._tag !== "Idle"
          ? new RoundAlreadyStarted()
          : [new BreakerRoundStarted({ round: command.round, at: iso(now) })],
      RecordAttack: (state, command, { now }) => {
        if (state._tag !== "Running") return new RoundNotRunning();
        if (state.attackIds.includes(command.attackId)) {
          return new DuplicateAttackId({ attackId: command.attackId });
        }
        if (command.actualAllowed) {
          return [
            new DisproofRecorded({
              attackId: command.attackId,
              boundary: command.boundary,
              wasmSha256: command.wasmSha256,
              reason: command.reason,
              at: iso(now),
            }),
          ];
        }
        return [
          new AttackCaught({
            attackId: command.attackId,
            boundary: command.boundary,
            wasmSha256: command.wasmSha256,
            reason: command.reason,
            at: iso(now),
          }),
        ];
      },
      FinishBreakerRound: (state, _command, { now }) => {
        if (state._tag !== "Running") return new RoundNotRunning();
        return [
          new BreakerRoundFinished({
            totalAttacks: state.attackIds.length,
            caught: state.caught,
            disproofCount: state.disproofCount,
            at: iso(now),
          }),
        ];
      },
    },
    evolve: {
      BreakerRoundStarted: (_, event) => ({
        _tag: "Running" as const,
        round: event.round,
        attackIds: [],
        caught: 0,
        disproofCount: 0,
      }),
      AttackCaught: (state, event) =>
        state._tag === "Running"
          ? {
              ...state,
              attackIds: [...state.attackIds, event.attackId],
              caught: state.caught + 1,
            }
          : state,
      DisproofRecorded: (state, event) =>
        state._tag === "Running"
          ? {
              ...state,
              attackIds: [...state.attackIds, event.attackId],
              disproofCount: state.disproofCount + 1,
            }
          : state,
      BreakerRoundFinished: (state, event) =>
        state._tag === "Running"
          ? {
              _tag: "Finished" as const,
              round: state.round,
              totalAttacks: event.totalAttacks,
              caught: event.caught,
              disproofCount: event.disproofCount,
            }
          : state,
    },
  },
  { description: "Records a Gate Maker vs Gate Breaker adversarial round and its verified disproofs." },
) {}
