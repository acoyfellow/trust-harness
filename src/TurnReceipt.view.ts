import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { BoundaryName, TurnId } from "./ids.ts";
import { TurnOutcome } from "./schemas.ts";
import { Turn } from "./Turn/Turn.aggregate.ts";

export const BoundaryRecord = Schema.Struct({
  boundary: BoundaryName,
  allow: Schema.Boolean,
  reason: Schema.String,
  wasmSha256: Schema.NullOr(Schema.String),
  at: Schema.String,
});
export type BoundaryRecord = typeof BoundaryRecord.Type;

export const TurnReceiptState = Schema.Struct({
  outcome: TurnOutcome,
  blockedAt: Schema.NullOr(BoundaryName),
  blockedReason: Schema.NullOr(Schema.String),
  records: Schema.Array(BoundaryRecord),
  held: Schema.Number,
  broken: Schema.Number,
  unbacked: Schema.Number,
});
export type TurnReceiptState = typeof TurnReceiptState.Type;

const append = (state: TurnReceiptState, record: BoundaryRecord): ReadonlyArray<BoundaryRecord> => [
  ...state.records,
  record,
];

export class TurnReceipt extends Domain.View(
  "TurnReceipt",
  {
    from: [Turn],
    key: TurnId,
    keyOf: {
      TurnSubmitted: ({ source }) => TurnId.make(source.id),
      PreflightPassed: ({ source }) => TurnId.make(source.id),
      PreflightBlocked: ({ source }) => TurnId.make(source.id),
      ToolAdmitted: ({ source }) => TurnId.make(source.id),
      ToolDenied: ({ source }) => TurnId.make(source.id),
      ObservationTrusted: ({ source }) => TurnId.make(source.id),
      ObservationBlocked: ({ source }) => TurnId.make(source.id),
      TurnSettled: ({ source }) => TurnId.make(source.id),
      FailClosedBlocked: ({ source }) => TurnId.make(source.id),
    },
    state: TurnReceiptState,
    initial: {
      outcome: "pending",
      blockedAt: null,
      blockedReason: null,
      records: [],
      held: 0,
      broken: 0,
      unbacked: 0,
    },
    evolve: {
      TurnSubmitted: (state) => state,
      PreflightPassed: (state, event) => ({
        ...state,
        records: append(state, {
          boundary: "preflight",
          allow: true,
          reason: event.reason,
          wasmSha256: event.wasmSha256,
          at: event.at,
        }),
      }),
      PreflightBlocked: (state, event) => ({
        ...state,
        outcome: "blocked" as const,
        blockedAt: "preflight" as const,
        blockedReason: event.reason,
        records: append(state, {
          boundary: "preflight",
          allow: false,
          reason: event.reason,
          wasmSha256: event.wasmSha256,
          at: event.at,
        }),
      }),
      ToolAdmitted: (state, event) => ({
        ...state,
        records: append(state, {
          boundary: "admit",
          allow: true,
          reason: `${event.callId}: ${event.reason}`,
          wasmSha256: event.wasmSha256,
          at: event.at,
        }),
      }),
      ToolDenied: (state, event) => ({
        ...state,
        outcome: "blocked" as const,
        blockedAt: "admit" as const,
        blockedReason: event.reason,
        records: append(state, {
          boundary: "admit",
          allow: false,
          reason: `${event.callId}: ${event.reason}`,
          wasmSha256: event.wasmSha256,
          at: event.at,
        }),
      }),
      ObservationTrusted: (state, event) => ({
        ...state,
        records: append(state, {
          boundary: "observe",
          allow: true,
          reason: `${event.callId}: ${event.status}`,
          wasmSha256: event.wasmSha256,
          at: event.at,
        }),
      }),
      ObservationBlocked: (state, event) => ({
        ...state,
        outcome: "blocked" as const,
        blockedAt: "observe" as const,
        blockedReason: `${event.status}: ${event.reason}`,
        records: append(state, {
          boundary: "observe",
          allow: false,
          reason: `${event.callId}: ${event.status}`,
          wasmSha256: event.wasmSha256,
          at: event.at,
        }),
      }),
      TurnSettled: (state, event) => ({
        ...state,
        outcome: event.outcome,
        held: event.held,
        broken: event.broken,
        unbacked: event.unbacked,
        records: append(state, {
          boundary: "verdict",
          allow: event.action === "pass",
          reason: `${event.action} (held=${event.held} broken=${event.broken} unbacked=${event.unbacked})`,
          wasmSha256: event.wasmSha256,
          at: event.at,
        }),
      }),
      FailClosedBlocked: (state, event) => ({
        ...state,
        outcome: "blocked" as const,
        blockedAt: event.boundary,
        blockedReason: `fail-closed: ${event.reason}`,
        records: append(state, {
          boundary: event.boundary,
          allow: false,
          reason: `fail-closed: ${event.reason}`,
          wasmSha256: null,
          at: event.at,
        }),
      }),
    },
  },
  { description: "Auditable per-turn receipt across all four WASM trust boundaries." },
) {}
