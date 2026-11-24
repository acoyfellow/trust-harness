import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { TurnId } from "../ids.ts";
import { PreflightOutput } from "../schemas.ts";
import { PreflightAlreadyApplied, TurnClosed, TurnNotStarted } from "./Turn.rejections.ts";

export class PreflightPassed extends Domain.Event("PreflightPassed", {
  totalBytes: Schema.Number,
  reason: Schema.String,
  wasmSha256: Schema.String,
  at: Schema.String,
}) {}

export class PreflightBlocked extends Domain.Event("PreflightBlocked", {
  reason: Schema.String,
  unsupportedParts: Schema.Array(Schema.String),
  wasmSha256: Schema.String,
  at: Schema.String,
}) {}

export class ApplyPreflight extends Domain.Command(
  "ApplyPreflight",
  {
    target: TurnId,
    input: { decision: PreflightOutput },
    events: [PreflightPassed, PreflightBlocked],
    rejects: [TurnNotStarted, PreflightAlreadyApplied, TurnClosed],
  },
  { description: "Record boundary 1 (preflight) decision from the pinned WASM kernel." },
) {}
