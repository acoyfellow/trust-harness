import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CallId, TurnId } from "../ids.ts";
import { ObservationStatus, ObserveOutput } from "../schemas.ts";
import { CallAlreadyObserved, CallNotAdmitted, TurnClosed, TurnNotPreflighted } from "./Turn.rejections.ts";

export class ObservationTrusted extends Domain.Event("ObservationTrusted", {
  callId: CallId,
  status: ObservationStatus,
  reason: Schema.String,
  wasmSha256: Schema.String,
  at: Schema.String,
}) {}

export class ObservationBlocked extends Domain.Event("ObservationBlocked", {
  callId: CallId,
  status: ObservationStatus,
  reason: Schema.String,
  wasmSha256: Schema.String,
  at: Schema.String,
}) {}

export class ApplyObservation extends Domain.Command(
  "ApplyObservation",
  {
    target: TurnId,
    input: {
      callId: CallId,
      decision: ObserveOutput,
    },
    events: [ObservationTrusted, ObservationBlocked],
    rejects: [TurnNotPreflighted, CallNotAdmitted, CallAlreadyObserved, TurnClosed],
  },
  { description: "Record boundary 3 (observe) decision for an admitted tool result." },
) {}
