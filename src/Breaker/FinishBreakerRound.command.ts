import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { BreakerRunId } from "../ids.ts";
import { RoundNotRunning } from "./Breaker.rejections.ts";

export class BreakerRoundFinished extends Domain.Event("BreakerRoundFinished", {
  totalAttacks: Schema.Number,
  caught: Schema.Number,
  disproofCount: Schema.Number,
  at: Schema.String,
}) {}

export class FinishBreakerRound extends Domain.Command(
  "FinishBreakerRound",
  {
    target: BreakerRunId,
    input: {},
    events: [BreakerRoundFinished],
    rejects: [RoundNotRunning],
  },
  { description: "Close a Maker-vs-Breaker round and freeze its caught and disproof counts." },
) {}
