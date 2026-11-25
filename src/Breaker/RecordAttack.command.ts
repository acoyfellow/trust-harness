import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { BoundaryName, BreakerRunId } from "../ids.ts";
import { DuplicateAttackId, RoundNotRunning } from "./Breaker.rejections.ts";

export class AttackCaught extends Domain.Event("AttackCaught", {
  attackId: Schema.String,
  boundary: BoundaryName,
  wasmSha256: Schema.String,
  reason: Schema.String,
  at: Schema.String,
}) {}

export class DisproofRecorded extends Domain.Event("DisproofRecorded", {
  attackId: Schema.String,
  boundary: BoundaryName,
  wasmSha256: Schema.String,
  reason: Schema.String,
  at: Schema.String,
}) {}

export class RecordAttack extends Domain.Command(
  "RecordAttack",
  {
    target: BreakerRunId,
    input: {
      attackId: Schema.String,
      boundary: BoundaryName,
      actualAllowed: Schema.Boolean,
      wasmSha256: Schema.String,
      reason: Schema.String,
    },
    events: [AttackCaught, DisproofRecorded],
    rejects: [RoundNotRunning, DuplicateAttackId],
  },
  { description: "Record a real WASM evaluation of an adversarial attack as caught or a verified disproof." },
) {}
