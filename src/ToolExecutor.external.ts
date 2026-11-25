import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CallId } from "./ids.ts";
import { AdmitAction, ObserveInput } from "./schemas.ts";

export class ToolExecutionFailed extends Domain.Rejection("ToolExecutionFailed", {
  callId: CallId,
  reason: Schema.String,
}) {}

export class ToolExecutor extends Domain.ExternalSystem(
  "ToolExecutor",
  {
    execute: {
      args: { callId: CallId, action: AdmitAction },
      success: ObserveInput,
      error: ToolExecutionFailed,
    },
  },
  { description: "Executes an admitted tool action and returns its observed external result." },
) {}
