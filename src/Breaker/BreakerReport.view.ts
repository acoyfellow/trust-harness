import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { BreakerRunId } from "../ids.ts";
import { DisproofWitness } from "../schemas.ts";
import { BreakerRun } from "./BreakerRun.aggregate.ts";

export const BreakerReportState = Schema.Struct({
  round: Schema.Number,
  status: Schema.Literals(["idle", "running", "finished"]),
  totalAttacks: Schema.Number,
  caught: Schema.Number,
  disproofCount: Schema.Number,
  disproofs: Schema.Array(DisproofWitness),
});
export type BreakerReportState = typeof BreakerReportState.Type;

export class BreakerReport extends Domain.View(
  "BreakerReport",
  {
    from: [BreakerRun],
    key: BreakerRunId,
    keyOf: {
      BreakerRoundStarted: ({ source }) => BreakerRunId.make(source.id),
      AttackCaught: ({ source }) => BreakerRunId.make(source.id),
      DisproofRecorded: ({ source }) => BreakerRunId.make(source.id),
      BreakerRoundFinished: ({ source }) => BreakerRunId.make(source.id),
    },
    state: BreakerReportState,
    initial: {
      round: 0,
      status: "idle",
      totalAttacks: 0,
      caught: 0,
      disproofCount: 0,
      disproofs: [],
    },
    evolve: {
      BreakerRoundStarted: (state, event) => ({
        ...state,
        round: event.round,
        status: "running" as const,
      }),
      AttackCaught: (state) => ({
        ...state,
        totalAttacks: state.totalAttacks + 1,
        caught: state.caught + 1,
      }),
      DisproofRecorded: (state, event) => ({
        ...state,
        totalAttacks: state.totalAttacks + 1,
        disproofCount: state.disproofCount + 1,
        disproofs: [
          ...state.disproofs,
          {
            attackId: event.attackId,
            boundary: event.boundary,
            wasmSha256: event.wasmSha256,
            reason: event.reason,
          },
        ],
      }),
      BreakerRoundFinished: (state, event) => ({
        ...state,
        status: "finished" as const,
        totalAttacks: event.totalAttacks,
        caught: event.caught,
        disproofCount: event.disproofCount,
      }),
    },
  },
  { description: "Read model summarizing caught attacks and verified disproofs for a Breaker round." },
) {}
