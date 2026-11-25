import * as Schema from "effect/Schema";
import { BoundaryName, CallId } from "./ids.ts";

export const RequestPart = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  source: Schema.String,
  text: Schema.String,
});
export type RequestPart = typeof RequestPart.Type;

export const PreflightInput = Schema.Struct({
  max_total_bytes: Schema.Number,
  max_part_bytes: Schema.Number,
  parts: Schema.Array(RequestPart),
});
export type PreflightInput = typeof PreflightInput.Type;

export const TrustLabel = Schema.Literals(["system", "user", "untrusted-external", "tool-output"]);
export type TrustLabel = typeof TrustLabel.Type;

export const PartPlan = Schema.Struct({
  id: Schema.String,
  bytes: Schema.Number,
  label: TrustLabel,
  included: Schema.Boolean,
  reason: Schema.NullOr(Schema.String),
});
export type PartPlan = typeof PartPlan.Type;

export const PreflightOutput = Schema.Struct({
  allow: Schema.Boolean,
  reason: Schema.String,
  total_bytes: Schema.Number,
  unsupported_parts: Schema.Array(Schema.String),
  plan: Schema.Array(PartPlan),
  wasmSha256: Schema.String,
});
export type PreflightOutput = typeof PreflightOutput.Type;

export const AdmitAction = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("write"), path: Schema.String, content: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("edit"), path: Schema.String, payload: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("bash"), command: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("lockfile"),
    text: Schema.String,
    policyJson: Schema.optional(Schema.String),
  }),
]);
export type AdmitAction = typeof AdmitAction.Type;

export const AdmitOutput = Schema.Struct({
  allow: Schema.Boolean,
  reason: Schema.String,
  wasmSha256: Schema.String,
});
export type AdmitOutput = typeof AdmitOutput.Type;

export const ObserveInput = Schema.Struct({
  service: Schema.String,
  http_status: Schema.Number,
  claimed_success: Schema.Boolean,
  observed_proof: Schema.Boolean,
  terminal_fault: Schema.String,
  retrieval_authority: Schema.String,
  retrieved_text: Schema.String,
});
export type ObserveInput = typeof ObserveInput.Type;

export const ObservationStatus = Schema.Literals([
  "trusted",
  "hostile-retrieval",
  "false-success",
  "terminal-fault",
  "invalid",
]);
export type ObservationStatus = typeof ObservationStatus.Type;

export const ObserveOutput = Schema.Struct({
  status: ObservationStatus,
  allow: Schema.Boolean,
  reason: Schema.String,
  wasmSha256: Schema.String,
});
export type ObserveOutput = typeof ObserveOutput.Type;

export const ClaimField = Schema.Struct({
  id: Schema.String,
  claimed: Schema.NullOr(Schema.String),
  found: Schema.NullOr(Schema.String),
  anchored: Schema.Boolean,
});
export type ClaimField = typeof ClaimField.Type;

export const VerdictInput = Schema.Struct({
  fields: Schema.Array(ClaimField),
});
export type VerdictInput = typeof VerdictInput.Type;

export const VerdictAction = Schema.Literals(["pass", "retry", "ask"]);
export type VerdictAction = typeof VerdictAction.Type;

export const FieldStatus = Schema.Literals(["held", "broken", "unbacked", "unclaimed"]);
export type FieldStatus = typeof FieldStatus.Type;

export const VerdictLine = Schema.Struct({
  id: Schema.String,
  status: FieldStatus,
});
export type VerdictLine = typeof VerdictLine.Type;

export const VerdictOutput = Schema.Struct({
  lines: Schema.Array(VerdictLine),
  held: Schema.Number,
  broken: Schema.Number,
  unbacked: Schema.Number,
  action: VerdictAction,
  wasmSha256: Schema.String,
});
export type VerdictOutput = typeof VerdictOutput.Type;

export const PlannedToolCall = Schema.Struct({
  callId: CallId,
  action: AdmitAction,
});
export type PlannedToolCall = typeof PlannedToolCall.Type;

export const DisproofProposal = Schema.Struct({
  foundCounterexample: Schema.Boolean,
  summary: Schema.String,
  counterexampleFields: Schema.Array(ClaimField),
});
export type DisproofProposal = typeof DisproofProposal.Type;

export const DisproofWitness = Schema.Struct({
  attackId: Schema.String,
  boundary: BoundaryName,
  wasmSha256: Schema.String,
  reason: Schema.String,
});
export type DisproofWitness = typeof DisproofWitness.Type;

export const TurnOutcome = Schema.Literals(["pending", "passed", "disproven", "retry", "ask", "blocked"]);
export type TurnOutcome = typeof TurnOutcome.Type;
