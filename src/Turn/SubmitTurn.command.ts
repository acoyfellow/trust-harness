import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { TurnId } from "../ids.ts";
import { PlannedToolCall, PreflightInput, VerdictInput } from "../schemas.ts";
import { TurnAlreadyStarted } from "./Turn.rejections.ts";

export class TurnSubmitted extends Domain.Event("TurnSubmitted", {
  preflight: PreflightInput,
  toolCalls: Schema.Array(PlannedToolCall),
  verdict: VerdictInput,
  at: Schema.String,
}) {}

export class SubmitTurn extends Domain.Command(
  "SubmitTurn",
  {
    target: TurnId,
    input: {
      preflight: PreflightInput,
      toolCalls: Schema.Array(PlannedToolCall),
      verdict: VerdictInput,
    },
    events: [TurnSubmitted],
    rejects: [TurnAlreadyStarted],
  },
  { description: "Start a guarded agent turn across all four WASM boundaries." },
) {}
