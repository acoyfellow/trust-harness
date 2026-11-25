import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class RoundAlreadyStarted extends Domain.Rejection("RoundAlreadyStarted") {}

export class RoundNotRunning extends Domain.Rejection("RoundNotRunning") {}

export class DuplicateAttackId extends Domain.Rejection("DuplicateAttackId", {
  attackId: Schema.String,
}) {}
