import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { TurnId } from "../ids.ts";
import { TurnOutcome, VerdictAction, VerdictOutput } from "../schemas.ts";
import { PendingObservations, TurnClosed, TurnNotPreflighted } from "./Turn.rejections.ts";

export class TurnSettled extends Domain.Event("TurnSettled", {
  action: VerdictAction,
  outcome: TurnOutcome,
  held: Schema.Number,
  broken: Schema.Number,
  unbacked: Schema.Number,
  wasmSha256: Schema.String,
  at: Schema.String,
}) {}

export class ApplyVerdict extends Domain.Command(
  "ApplyVerdict",
  {
    target: TurnId,
    input: { decision: VerdictOutput },
    events: [TurnSettled],
    rejects: [TurnNotPreflighted, PendingObservations, TurnClosed],
  },
  { description: "Record boundary 4 (verdict) ruling after all admitted tool results are observed." },
) {}
