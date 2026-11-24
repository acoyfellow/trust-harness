import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { BoundaryName } from "./ids.ts";
import {
  AdmitAction,
  AdmitOutput,
  ObserveInput,
  ObserveOutput,
  PreflightInput,
  PreflightOutput,
  VerdictInput,
  VerdictOutput,
} from "./schemas.ts";

export class WasmJudgeUnavailable extends Domain.Rejection("WasmJudgeUnavailable", {
  boundary: BoundaryName,
  reason: Schema.String,
}) {}

export class WasmJudge extends Domain.ExternalSystem(
  "WasmJudge",
  {
    preflight: {
      args: { input: PreflightInput },
      success: PreflightOutput,
      error: WasmJudgeUnavailable,
    },
    admit: {
      args: { action: AdmitAction },
      success: AdmitOutput,
      error: WasmJudgeUnavailable,
    },
    observe: {
      args: { input: ObserveInput },
      success: ObserveOutput,
      error: WasmJudgeUnavailable,
    },
    verdict: {
      args: { input: VerdictInput },
      success: VerdictOutput,
      error: WasmJudgeUnavailable,
    },
  },
  { description: "Four SHA-256-pinned Rust/WASM policy boundaries behind one fail-closed ABI." },
) {}
