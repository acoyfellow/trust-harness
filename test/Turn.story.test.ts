import { Story } from "@alchemy.run/domain/Story";
import { it } from "@effect/vitest";
import * as Layer from "effect/Layer";
import { CriticUnavailable, DisproofCritic } from "../src/DisproofCritic.external.ts";
import { HarnessHandlers, TrustHarness } from "../src/Harness.model.ts";
import { CallId, TurnId } from "../src/ids.ts";
import { ToolExecutor } from "../src/ToolExecutor.external.ts";
import { ApplyDisproof, DisproofFailed, TurnDisproven } from "../src/Turn/ApplyDisproof.command.ts";
import { ApplyObservation, ObservationBlocked, ObservationTrusted } from "../src/Turn/ApplyObservation.command.ts";
import { ApplyPreflight, PreflightBlocked, PreflightPassed } from "../src/Turn/ApplyPreflight.command.ts";
import { ApplyToolAdmit, ToolAdmitted, ToolDenied } from "../src/Turn/ApplyToolAdmit.command.ts";
import { ApplyVerdict, TurnSettled, VerdictPassed } from "../src/Turn/ApplyVerdict.command.ts";
import { FailClosedBlocked } from "../src/Turn/BlockTurn.command.ts";
import { SubmitTurn, TurnSubmitted } from "../src/Turn/SubmitTurn.command.ts";
import { Turn } from "../src/Turn/Turn.aggregate.ts";
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
} from "../src/Turn/Turn.rejections.ts";
import { TurnReceipt } from "../src/TurnReceipt.view.ts";
import { WasmJudge, WasmJudgeUnavailable } from "../src/WasmJudge.external.ts";

const story = Story.make(TrustHarness, {
  layer: HarnessHandlers.pipe(Layer.provide(Layer.empty)),
  stub: [WasmJudge, ToolExecutor, DisproofCritic],
});

const turn = (id: string) => Turn.ref(TurnId.make(id));
const callId = (id: string) => CallId.make(id);
const nine = "2026-01-01T09:00:00Z";
const isoNine = new Date(nine).toISOString();

const samplePreflight = {
  max_total_bytes: 1024,
  max_part_bytes: 512,
  parts: [{ id: "u1", kind: "text", source: "user", text: "run tests" }],
};

const sampleToolCall = {
  callId: callId("c1"),
  action: { kind: "bash" as const, command: "ls src" },
};

const sampleObservation = {
  service: "cloudflare-identity",
  http_status: 200,
  claimed_success: true,
  observed_proof: true,
  terminal_fault: "none",
  retrieval_authority: "none",
  retrieved_text: "ok",
};

const sampleVerdict = {
  fields: [{ id: "tests_passed", claimed: "12", found: "12", anchored: true }],
};

const preflightOk = {
  allow: true,
  reason: "preflight passed",
  total_bytes: 9,
  unsupported_parts: [],
  plan: [{ id: "u1", bytes: 9, label: "user" as const, included: true, reason: null }],
  wasmSha256: "sha-preflight",
};

const preflightBad = {
  allow: false,
  reason: "authority spoof in untrusted part ext",
  total_bytes: 0,
  unsupported_parts: [],
  plan: [],
  wasmSha256: "sha-preflight",
};

const admitOk = { allow: true, reason: "bash allowed", wasmSha256: "sha-admit" };
const admitBad = { allow: false, reason: "refuse to write secret-shaped path .env", wasmSha256: "sha-admit" };
const observeOk = { status: "trusted" as const, allow: true, reason: "observed proof verified", wasmSha256: "sha-observe" };
const observeBad = {
  status: "hostile-retrieval" as const,
  allow: false,
  reason: "retrieved content claims authority or instruction override",
  wasmSha256: "sha-observe",
};
const verdictPass = {
  lines: [{ id: "tests_passed", status: "held" as const }],
  held: 1,
  broken: 0,
  unbacked: 0,
  action: "pass" as const,
  wasmSha256: "sha-verdict",
};
const verdictRetry = {
  lines: [{ id: "tests_passed", status: "broken" as const }],
  held: 0,
  broken: 1,
  unbacked: 0,
  action: "retry" as const,
  wasmSha256: "sha-verdict",
};

it.effect("happy path walks preflight -> admit -> execute -> observe -> verdict -> disproof survival", () =>
  story(
    Story.clock(nine),
    Story.when(turn("t1"), new SubmitTurn({ preflight: samplePreflight, toolCalls: [sampleToolCall], verdict: sampleVerdict })),
    Story.then(
      turn("t1"),
      new TurnSubmitted({ preflight: samplePreflight, toolCalls: [sampleToolCall], verdict: sampleVerdict, at: isoNine }),
    ),
    Story.call("t1", WasmJudge.preflight, { input: samplePreflight }),
    Story.succeed("t1", WasmJudge.preflight, preflightOk),
    Story.then(turn("t1"), new PreflightPassed({ totalBytes: 9, reason: "preflight passed", wasmSha256: "sha-preflight", at: isoNine })),
    Story.call("t1", WasmJudge.admit, { action: sampleToolCall.action }),
    Story.succeed("t1", WasmJudge.admit, admitOk),
    Story.then(turn("t1"), new ToolAdmitted({ callId: callId("c1"), toolKind: "bash", reason: "bash allowed", wasmSha256: "sha-admit", at: isoNine })),
    Story.call("t1", ToolExecutor.execute, { callId: callId("c1"), action: sampleToolCall.action }),
    Story.succeed("t1", ToolExecutor.execute, sampleObservation),
    Story.call("t1", WasmJudge.observe, { input: sampleObservation }),
    Story.succeed("t1", WasmJudge.observe, observeOk),
    Story.then(turn("t1"), new ObservationTrusted({ callId: callId("c1"), status: "trusted", reason: "observed proof verified", wasmSha256: "sha-observe", at: isoNine })),
    Story.call("t1", WasmJudge.verdict, { input: sampleVerdict }),
    Story.succeed("t1", WasmJudge.verdict, verdictPass),
    Story.then(turn("t1"), new VerdictPassed({ held: 1, broken: 0, unbacked: 0, wasmSha256: "sha-verdict", at: isoNine })),
    Story.call("t1", DisproofCritic.challenge, { turnId: TurnId.make("t1"), verdict: sampleVerdict }),
    Story.succeed("t1", DisproofCritic.challenge, { foundCounterexample: false, summary: "no falsifying counterexample", counterexampleFields: [] }),
    Story.then(turn("t1"), new DisproofFailed({ summary: "no falsifying counterexample", wasmSha256: "sha-verdict", at: isoNine })),
    Story.state(turn("t1"), { _tag: "Closed", outcome: "passed" }),
    Story.view(TurnReceipt, TurnId.make("t1"), { outcome: "passed", blockedAt: null, held: 1, broken: 0, unbacked: 0 }),
  ),
);

it.effect("boundary 1 preflight block closes turn before admit or execution", () =>
  story(
    Story.clock(nine),
    Story.when(turn("t2"), new SubmitTurn({ preflight: samplePreflight, toolCalls: [sampleToolCall], verdict: sampleVerdict })),
    Story.then(
      turn("t2"),
      new TurnSubmitted({ preflight: samplePreflight, toolCalls: [sampleToolCall], verdict: sampleVerdict, at: isoNine }),
    ),
    Story.call("t2", WasmJudge.preflight, { input: samplePreflight }),
    Story.succeed("t2", WasmJudge.preflight, preflightBad),
    Story.then(
      turn("t2"),
      new PreflightBlocked({
        reason: "authority spoof in untrusted part ext",
        unsupportedParts: [],
        wasmSha256: "sha-preflight",
        at: isoNine,
      }),
    ),
    Story.state(turn("t2"), { _tag: "Closed", outcome: "blocked" }),
    Story.view(TurnReceipt, TurnId.make("t2"), { outcome: "blocked", blockedAt: "preflight" }),
  ),
);

it.effect("boundary 2 admit deny closes turn without ever calling ToolExecutor or observe", () =>
  story(
    Story.clock(nine),
    Story.when(turn("t3"), new SubmitTurn({ preflight: samplePreflight, toolCalls: [sampleToolCall], verdict: sampleVerdict })),
    Story.then(
      turn("t3"),
      new TurnSubmitted({ preflight: samplePreflight, toolCalls: [sampleToolCall], verdict: sampleVerdict, at: isoNine }),
    ),
    Story.call("t3", WasmJudge.preflight, { input: samplePreflight }),
    Story.succeed("t3", WasmJudge.preflight, preflightOk),
    Story.then(turn("t3"), new PreflightPassed({ totalBytes: 9, reason: "preflight passed", wasmSha256: "sha-preflight", at: isoNine })),
    Story.call("t3", WasmJudge.admit, { action: sampleToolCall.action }),
    Story.succeed("t3", WasmJudge.admit, admitBad),
    Story.then(
      turn("t3"),
      new ToolDenied({
        callId: callId("c1"),
        toolKind: "bash",
        reason: "refuse to write secret-shaped path .env",
        wasmSha256: "sha-admit",
        at: isoNine,
      }),
    ),
    Story.state(turn("t3"), { _tag: "Closed", outcome: "blocked" }),
    Story.view(TurnReceipt, TurnId.make("t3"), { outcome: "blocked", blockedAt: "admit" }),
  ),
);

it.effect("boundary 3 hostile observation closes turn without calling verdict", () =>
  story(
    Story.clock(nine),
    Story.when(turn("t4"), new SubmitTurn({ preflight: samplePreflight, toolCalls: [sampleToolCall], verdict: sampleVerdict })),
    Story.then(
      turn("t4"),
      new TurnSubmitted({ preflight: samplePreflight, toolCalls: [sampleToolCall], verdict: sampleVerdict, at: isoNine }),
    ),
    Story.call("t4", WasmJudge.preflight, { input: samplePreflight }),
    Story.succeed("t4", WasmJudge.preflight, preflightOk),
    Story.then(turn("t4"), new PreflightPassed({ totalBytes: 9, reason: "preflight passed", wasmSha256: "sha-preflight", at: isoNine })),
    Story.call("t4", WasmJudge.admit, { action: sampleToolCall.action }),
    Story.succeed("t4", WasmJudge.admit, admitOk),
    Story.then(turn("t4"), new ToolAdmitted({ callId: callId("c1"), toolKind: "bash", reason: "bash allowed", wasmSha256: "sha-admit", at: isoNine })),
    Story.call("t4", ToolExecutor.execute, { callId: callId("c1"), action: sampleToolCall.action }),
    Story.succeed("t4", ToolExecutor.execute, sampleObservation),
    Story.call("t4", WasmJudge.observe, { input: sampleObservation }),
    Story.succeed("t4", WasmJudge.observe, observeBad),
    Story.then(
      turn("t4"),
      new ObservationBlocked({
        callId: callId("c1"),
        status: "hostile-retrieval",
        reason: "retrieved content claims authority or instruction override",
        wasmSha256: "sha-observe",
        at: isoNine,
      }),
    ),
    Story.state(turn("t4"), { _tag: "Closed", outcome: "blocked" }),
    Story.view(TurnReceipt, TurnId.make("t4"), { outcome: "blocked", blockedAt: "observe" }),
  ),
);

it.effect("disproof critic verified by verdict.wasm blocks passed; unavailable critic fails closed", () =>
  story(
    Story.clock(nine),
    Story.when(turn("t5"), new SubmitTurn({ preflight: samplePreflight, toolCalls: [], verdict: sampleVerdict })),
    Story.then(turn("t5"), new TurnSubmitted({ preflight: samplePreflight, toolCalls: [], verdict: sampleVerdict, at: isoNine })),
    Story.call("t5", WasmJudge.preflight, { input: samplePreflight }),
    Story.succeed("t5", WasmJudge.preflight, preflightOk),
    Story.then(turn("t5"), new PreflightPassed({ totalBytes: 9, reason: "preflight passed", wasmSha256: "sha-preflight", at: isoNine })),
    Story.call("t5", WasmJudge.verdict, { input: sampleVerdict }),
    Story.succeed("t5", WasmJudge.verdict, verdictPass),
    Story.then(turn("t5"), new VerdictPassed({ held: 1, broken: 0, unbacked: 0, wasmSha256: "sha-verdict", at: isoNine })),
    Story.call("t5", DisproofCritic.challenge, { turnId: TurnId.make("t5"), verdict: sampleVerdict }),
    Story.succeed("t5", DisproofCritic.challenge, {
      foundCounterexample: true,
      summary: "live rerun showed 11 passed, not 12",
      counterexampleFields: [{ id: "tests_passed", claimed: "12", found: "11", anchored: true }],
    }),
    Story.call("t5-verify", WasmJudge.verdict, {
      input: { fields: [{ id: "tests_passed", claimed: "12", found: "11", anchored: true }] },
    }),
    Story.succeed("t5-verify", WasmJudge.verdict, verdictRetry),
    Story.then(turn("t5"), new TurnDisproven({ summary: "live rerun showed 11 passed, not 12", wasmSha256: "sha-verdict", at: isoNine })),
    Story.view(TurnReceipt, TurnId.make("t5"), { outcome: "disproven", blockedAt: "verdict" }),
    Story.when(turn("t6"), new SubmitTurn({ preflight: samplePreflight, toolCalls: [], verdict: sampleVerdict })),
    Story.then(turn("t6"), new TurnSubmitted({ preflight: samplePreflight, toolCalls: [], verdict: sampleVerdict, at: isoNine })),
    Story.call("t6", WasmJudge.preflight, { input: samplePreflight }),
    Story.succeed("t6", WasmJudge.preflight, preflightOk),
    Story.then(turn("t6"), new PreflightPassed({ totalBytes: 9, reason: "preflight passed", wasmSha256: "sha-preflight", at: isoNine })),
    Story.call("t6", WasmJudge.verdict, { input: sampleVerdict }),
    Story.succeed("t6", WasmJudge.verdict, verdictPass),
    Story.then(turn("t6"), new VerdictPassed({ held: 1, broken: 0, unbacked: 0, wasmSha256: "sha-verdict", at: isoNine })),
    Story.call("t6", DisproofCritic.challenge, { turnId: TurnId.make("t6"), verdict: sampleVerdict }),
    Story.fail("t6", DisproofCritic.challenge, new CriticUnavailable({ reason: "critic offline" })),
    Story.then(turn("t6"), new FailClosedBlocked({ boundary: "verdict", reason: "disproof critic unavailable: critic offline", at: isoNine })),
    Story.view(TurnReceipt, TurnId.make("t6"), { outcome: "blocked", blockedAt: "verdict" }),
  ),
);

it.effect("boundary 4 retry settles directly and missing wasm fails closed", () =>
  story(
    Story.clock(nine),
    Story.when(turn("t8"), new SubmitTurn({ preflight: samplePreflight, toolCalls: [], verdict: sampleVerdict })),
    Story.then(turn("t8"), new TurnSubmitted({ preflight: samplePreflight, toolCalls: [], verdict: sampleVerdict, at: isoNine })),
    Story.call("t8", WasmJudge.preflight, { input: samplePreflight }),
    Story.succeed("t8", WasmJudge.preflight, preflightOk),
    Story.then(turn("t8"), new PreflightPassed({ totalBytes: 9, reason: "preflight passed", wasmSha256: "sha-preflight", at: isoNine })),
    Story.call("t8", WasmJudge.verdict, { input: sampleVerdict }),
    Story.succeed("t8", WasmJudge.verdict, verdictRetry),
    Story.then(turn("t8"), new TurnSettled({ action: "retry", outcome: "retry", held: 0, broken: 1, unbacked: 0, wasmSha256: "sha-verdict", at: isoNine })),
    Story.view(TurnReceipt, TurnId.make("t8"), { outcome: "retry", broken: 1 }),
    Story.when(turn("t9"), new SubmitTurn({ preflight: samplePreflight, toolCalls: [], verdict: sampleVerdict })),
    Story.then(turn("t9"), new TurnSubmitted({ preflight: samplePreflight, toolCalls: [], verdict: sampleVerdict, at: isoNine })),
    Story.call("t9", WasmJudge.preflight, { input: samplePreflight }),
    Story.fail("t9", WasmJudge.preflight, new WasmJudgeUnavailable({ boundary: "preflight", reason: "wasm missing" })),
    Story.then(turn("t9"), new FailClosedBlocked({ boundary: "preflight", reason: "wasm missing", at: isoNine })),
    Story.view(TurnReceipt, TurnId.make("t9"), { outcome: "blocked", blockedAt: "preflight" }),
  ),
);

it.effect("aggregate enforces strict ordering including VerdictNotPassed before ApplyDisproof", () =>
  story(
    Story.clock(nine),
    Story.when(turn("t7"), new ApplyPreflight({ decision: preflightOk })),
    Story.rejected(new TurnNotStarted()),
    Story.when(turn("t7"), new ApplyToolAdmit({ callId: callId("c1"), toolKind: "bash", decision: admitOk })),
    Story.rejected(new TurnNotPreflighted()),
    Story.when(turn("t7"), new ApplyDisproof({ disproven: false, summary: "too early", wasmSha256: null })),
    Story.rejected(new VerdictNotPassed()),
    Story.when(turn("t7"), new SubmitTurn({ preflight: samplePreflight, toolCalls: [], verdict: sampleVerdict })),
    Story.then(turn("t7"), new TurnSubmitted({ preflight: samplePreflight, toolCalls: [], verdict: sampleVerdict, at: isoNine })),
    Story.call("t7", WasmJudge.preflight, { input: samplePreflight }),
    Story.when(turn("t7"), new SubmitTurn({ preflight: samplePreflight, toolCalls: [], verdict: sampleVerdict })),
    Story.rejected(new TurnAlreadyStarted()),
    Story.when(turn("t7"), new ApplyToolAdmit({ callId: callId("c1"), toolKind: "bash", decision: admitOk })),
    Story.rejected(new TurnNotPreflighted()),
    Story.succeed("t7", WasmJudge.preflight, preflightOk),
    Story.then(turn("t7"), new PreflightPassed({ totalBytes: 9, reason: "preflight passed", wasmSha256: "sha-preflight", at: isoNine })),
    Story.call("t7", WasmJudge.verdict, { input: sampleVerdict }),
    Story.when(turn("t7"), new ApplyPreflight({ decision: preflightOk })),
    Story.rejected(new PreflightAlreadyApplied()),
    Story.when(turn("t7"), new ApplyObservation({ callId: callId("ghost"), decision: observeOk })),
    Story.rejected(new CallNotAdmitted({ callId: callId("ghost") })),
    Story.when(turn("t7"), new ApplyToolAdmit({ callId: callId("c1"), toolKind: "bash", decision: admitOk })),
    Story.then(turn("t7"), new ToolAdmitted({ callId: callId("c1"), toolKind: "bash", reason: "bash allowed", wasmSha256: "sha-admit", at: isoNine })),
    Story.when(turn("t7"), new ApplyToolAdmit({ callId: callId("c1"), toolKind: "bash", decision: admitOk })),
    Story.rejected(new DuplicateCallId({ callId: callId("c1") })),
    Story.when(turn("t7"), new ApplyVerdict({ decision: verdictPass })),
    Story.rejected(new PendingObservations({ missingCallIds: [callId("c1")] })),
    Story.when(turn("t7"), new ApplyObservation({ callId: callId("c1"), decision: observeOk })),
    Story.then(turn("t7"), new ObservationTrusted({ callId: callId("c1"), status: "trusted", reason: "observed proof verified", wasmSha256: "sha-observe", at: isoNine })),
    Story.when(turn("t7"), new ApplyObservation({ callId: callId("c1"), decision: observeOk })),
    Story.rejected(new CallAlreadyObserved({ callId: callId("c1") })),
    Story.succeed("t7", WasmJudge.verdict, verdictPass),
    Story.then(turn("t7"), new VerdictPassed({ held: 1, broken: 0, unbacked: 0, wasmSha256: "sha-verdict", at: isoNine })),
    Story.call("t7", DisproofCritic.challenge, { turnId: TurnId.make("t7"), verdict: sampleVerdict }),
    Story.succeed("t7", DisproofCritic.challenge, { foundCounterexample: false, summary: "clean", counterexampleFields: [] }),
    Story.then(turn("t7"), new DisproofFailed({ summary: "clean", wasmSha256: "sha-verdict", at: isoNine })),
    Story.when(turn("t7"), new ApplyToolAdmit({ callId: callId("c2"), toolKind: "bash", decision: admitOk })),
    Story.rejected(new TurnClosed({ outcome: "passed" })),
  ),
);
