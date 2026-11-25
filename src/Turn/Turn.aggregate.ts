import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { CallId, TurnId } from "../ids.ts";
import { TurnOutcome, type VerdictAction } from "../schemas.ts";
import { ApplyDisproof, DisproofFailed, TurnDisproven } from "./ApplyDisproof.command.ts";
import { ApplyObservation, ObservationBlocked, ObservationTrusted } from "./ApplyObservation.command.ts";
import { ApplyPreflight, PreflightBlocked, PreflightPassed } from "./ApplyPreflight.command.ts";
import { ApplyToolAdmit, ToolAdmitted, ToolDenied } from "./ApplyToolAdmit.command.ts";
import { ApplyVerdict, TurnSettled, VerdictPassed } from "./ApplyVerdict.command.ts";
import { BlockTurn, FailClosedBlocked } from "./BlockTurn.command.ts";
import { SubmitTurn, TurnSubmitted } from "./SubmitTurn.command.ts";
import {
  CallAlreadyObserved,
  CallNotAdmitted,
  DuplicateCallId,
  PendingObservations,
  PreflightAlreadyApplied,
  TurnAlreadyStarted,
  TurnClosed,
  TurnNotPreflighted,
  TurnNotStarted,
  VerdictNotPassed,
} from "./Turn.rejections.ts";

const TurnState = Schema.Union([
  Schema.TaggedStruct("Idle", {}),
  Schema.TaggedStruct("AwaitingPreflight", {}),
  Schema.TaggedStruct("Active", {
    admittedCalls: Schema.Array(CallId),
    observedCalls: Schema.Array(CallId),
  }),
  Schema.TaggedStruct("AwaitingDisproof", {}),
  Schema.TaggedStruct("Closed", { outcome: TurnOutcome }),
]);
type TurnState = typeof TurnState.Type;

type ActiveState = Extract<TurnState, { _tag: "Active" }>;

const iso = (now: DateTime.Utc) => DateTime.formatIso(now);

const activeOrReject = (state: TurnState): ActiveState | TurnClosed | TurnNotPreflighted => {
  if (state._tag === "Active") return state;
  if (state._tag === "Closed") return new TurnClosed({ outcome: state.outcome });
  return new TurnNotPreflighted();
};

const outcomeFor = (action: VerdictAction): TurnOutcome => {
  if (action === "retry") return "retry";
  return "ask";
};

export class Turn extends Domain.Aggregate(
  "Turn",
  {
    id: TurnId,
    state: TurnState,
    initial: { _tag: "Idle" },
    commands: [
      SubmitTurn,
      ApplyPreflight,
      ApplyToolAdmit,
      ApplyObservation,
      ApplyVerdict,
      ApplyDisproof,
      BlockTurn,
    ],
    decide: {
      SubmitTurn: (state, command, { now }) =>
        state._tag !== "Idle"
          ? new TurnAlreadyStarted()
          : [
              new TurnSubmitted({
                preflight: command.preflight,
                toolCalls: command.toolCalls,
                verdict: command.verdict,
                at: iso(now),
              }),
            ],
      ApplyPreflight: (state, command, { now }) => {
        if (state._tag === "Idle") return new TurnNotStarted();
        if (state._tag === "Active" || state._tag === "AwaitingDisproof") {
          return new PreflightAlreadyApplied();
        }
        if (state._tag === "Closed") return new TurnClosed({ outcome: state.outcome });
        if (command.decision.allow) {
          return [
            new PreflightPassed({
              totalBytes: command.decision.total_bytes,
              reason: command.decision.reason,
              wasmSha256: command.decision.wasmSha256,
              at: iso(now),
            }),
          ];
        }
        return [
          new PreflightBlocked({
            reason: command.decision.reason,
            unsupportedParts: command.decision.unsupported_parts,
            wasmSha256: command.decision.wasmSha256,
            at: iso(now),
          }),
        ];
      },
      ApplyToolAdmit: (state, command, { now }) => {
        const active = activeOrReject(state);
        if (active._tag !== "Active") return active;
        if (active.admittedCalls.includes(command.callId)) {
          return new DuplicateCallId({ callId: command.callId });
        }
        if (command.decision.allow) {
          return [
            new ToolAdmitted({
              callId: command.callId,
              toolKind: command.toolKind,
              reason: command.decision.reason,
              wasmSha256: command.decision.wasmSha256,
              at: iso(now),
            }),
          ];
        }
        return [
          new ToolDenied({
            callId: command.callId,
            toolKind: command.toolKind,
            reason: command.decision.reason,
            wasmSha256: command.decision.wasmSha256,
            at: iso(now),
          }),
        ];
      },
      ApplyObservation: (state, command, { now }) => {
        const active = activeOrReject(state);
        if (active._tag !== "Active") return active;
        if (!active.admittedCalls.includes(command.callId)) {
          return new CallNotAdmitted({ callId: command.callId });
        }
        if (active.observedCalls.includes(command.callId)) {
          return new CallAlreadyObserved({ callId: command.callId });
        }
        if (command.decision.allow) {
          return [
            new ObservationTrusted({
              callId: command.callId,
              status: command.decision.status,
              reason: command.decision.reason,
              wasmSha256: command.decision.wasmSha256,
              at: iso(now),
            }),
          ];
        }
        return [
          new ObservationBlocked({
            callId: command.callId,
            status: command.decision.status,
            reason: command.decision.reason,
            wasmSha256: command.decision.wasmSha256,
            at: iso(now),
          }),
        ];
      },
      ApplyVerdict: (state, command, { now }) => {
        const active = activeOrReject(state);
        if (active._tag !== "Active") return active;
        const missing = active.admittedCalls.filter((id) => !active.observedCalls.includes(id));
        if (missing.length > 0) {
          return new PendingObservations({ missingCallIds: missing });
        }
        if (command.decision.action === "pass") {
          return [
            new VerdictPassed({
              held: command.decision.held,
              broken: command.decision.broken,
              unbacked: command.decision.unbacked,
              wasmSha256: command.decision.wasmSha256,
              at: iso(now),
            }),
          ];
        }
        const outcome = outcomeFor(command.decision.action);
        return [
          new TurnSettled({
            action: command.decision.action,
            outcome,
            held: command.decision.held,
            broken: command.decision.broken,
            unbacked: command.decision.unbacked,
            wasmSha256: command.decision.wasmSha256,
            at: iso(now),
          }),
        ];
      },
      ApplyDisproof: (state, command, { now }) => {
        if (state._tag === "Closed") return new TurnClosed({ outcome: state.outcome });
        if (state._tag !== "AwaitingDisproof") return new VerdictNotPassed();
        if (command.disproven) {
          return [
            new TurnDisproven({
              summary: command.summary,
              wasmSha256: command.wasmSha256 ?? "unverified",
              at: iso(now),
            }),
          ];
        }
        return [
          new DisproofFailed({
            summary: command.summary,
            wasmSha256: command.wasmSha256,
            at: iso(now),
          }),
        ];
      },
      BlockTurn: (state, command, { now }) =>
        state._tag === "Closed"
          ? new TurnClosed({ outcome: state.outcome })
          : [
              new FailClosedBlocked({
                boundary: command.boundary,
                reason: command.reason,
                at: iso(now),
              }),
            ],
    },
    evolve: {
      TurnSubmitted: () => ({ _tag: "AwaitingPreflight" as const }),
      PreflightPassed: () => ({
        _tag: "Active" as const,
        admittedCalls: [],
        observedCalls: [],
      }),
      PreflightBlocked: () => ({ _tag: "Closed" as const, outcome: "blocked" as const }),
      ToolAdmitted: (state, event) =>
        state._tag === "Active"
          ? { ...state, admittedCalls: [...state.admittedCalls, event.callId] }
          : state,
      ToolDenied: () => ({ _tag: "Closed" as const, outcome: "blocked" as const }),
      ObservationTrusted: (state, event) =>
        state._tag === "Active"
          ? { ...state, observedCalls: [...state.observedCalls, event.callId] }
          : state,
      ObservationBlocked: () => ({ _tag: "Closed" as const, outcome: "blocked" as const }),
      VerdictPassed: () => ({ _tag: "AwaitingDisproof" as const }),
      TurnSettled: (_, event) => ({ _tag: "Closed" as const, outcome: event.outcome }),
      TurnDisproven: () => ({ _tag: "Closed" as const, outcome: "disproven" as const }),
      DisproofFailed: () => ({ _tag: "Closed" as const, outcome: "passed" as const }),
      FailClosedBlocked: () => ({ _tag: "Closed" as const, outcome: "blocked" as const }),
    },
  },
  { description: "Guarded agent turn enforcing all four WASM trust boundaries plus adversarial disproof survival." },
) {}
