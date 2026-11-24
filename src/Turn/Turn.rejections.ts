import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { CallId } from "../ids.ts";

export class TurnAlreadyStarted extends Domain.Rejection("TurnAlreadyStarted") {}

export class TurnNotStarted extends Domain.Rejection("TurnNotStarted") {}

export class TurnNotPreflighted extends Domain.Rejection("TurnNotPreflighted") {}

export class PreflightAlreadyApplied extends Domain.Rejection("PreflightAlreadyApplied") {}

export class TurnClosed extends Domain.Rejection("TurnClosed", { outcome: Schema.String }) {}

export class DuplicateCallId extends Domain.Rejection("DuplicateCallId", { callId: CallId }) {}

export class CallNotAdmitted extends Domain.Rejection("CallNotAdmitted", { callId: CallId }) {}

export class CallAlreadyObserved extends Domain.Rejection("CallAlreadyObserved", { callId: CallId }) {}

export class PendingObservations extends Domain.Rejection("PendingObservations", {
  missingCallIds: Schema.Array(CallId),
}) {}
