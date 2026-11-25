import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { BreakerRunId } from "../ids.ts";
import { RoundAlreadyStarted } from "./Breaker.rejections.ts";

export class BreakerRoundStarted extends Domain.Event("BreakerRoundStarted", {
  round: Schema.Number,
  at: Schema.String,
}) {}

export class StartBreakerRound extends Domain.Command(
  "StartBreakerRound",
  {
    target: BreakerRunId,
    input: { round: Schema.Number },
    events: [BreakerRoundStarted],
    rejects: [RoundAlreadyStarted],
  },
  { description: "Start a Maker-vs-Breaker round against the pinned WASM gates." },
) {}
