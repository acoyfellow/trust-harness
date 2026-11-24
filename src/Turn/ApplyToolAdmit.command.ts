import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CallId, TurnId } from "../ids.ts";
import { AdmitOutput } from "../schemas.ts";
import { DuplicateCallId, TurnClosed, TurnNotPreflighted } from "./Turn.rejections.ts";

export class ToolAdmitted extends Domain.Event("ToolAdmitted", {
  callId: CallId,
  toolKind: Schema.String,
  reason: Schema.String,
  wasmSha256: Schema.String,
  at: Schema.String,
}) {}

export class ToolDenied extends Domain.Event("ToolDenied", {
  callId: CallId,
  toolKind: Schema.String,
  reason: Schema.String,
  wasmSha256: Schema.String,
  at: Schema.String,
}) {}

export class ApplyToolAdmit extends Domain.Command(
  "ApplyToolAdmit",
  {
    target: TurnId,
    input: {
      callId: CallId,
      toolKind: Schema.String,
      decision: AdmitOutput,
    },
    events: [ToolAdmitted, ToolDenied],
    rejects: [TurnNotPreflighted, DuplicateCallId, TurnClosed],
  },
  { description: "Record boundary 2 (admit) decision for a proposed tool action." },
) {}
