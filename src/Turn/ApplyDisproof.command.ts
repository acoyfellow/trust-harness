import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { TurnId } from "../ids.ts";
import { TurnClosed, VerdictNotPassed } from "./Turn.rejections.ts";

export class TurnDisproven extends Domain.Event("TurnDisproven", {
  summary: Schema.String,
  wasmSha256: Schema.String,
  at: Schema.String,
}) {}

export class DisproofFailed extends Domain.Event("DisproofFailed", {
  summary: Schema.String,
  wasmSha256: Schema.NullOr(Schema.String),
  at: Schema.String,
}) {}

export class ApplyDisproof extends Domain.Command(
  "ApplyDisproof",
  {
    target: TurnId,
    input: {
      disproven: Schema.Boolean,
      summary: Schema.String,
      wasmSha256: Schema.NullOr(Schema.String),
    },
    events: [TurnDisproven, DisproofFailed],
    rejects: [VerdictNotPassed, TurnClosed],
  },
  { description: "Close a verdict-passing turn only after it survives an adversarial disproof challenge." },
) {}
