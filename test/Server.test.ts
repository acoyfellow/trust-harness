import * as Domain from "@alchemy.run/domain";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  FailClosedWorkerCritic,
  FailClosedWorkerExecutor,
  FailClosedWorkerJudge,
} from "../server/WorkerAdapters.ts";
import { TrustHarnessApi } from "../src/Harness.api.ts";
import { HarnessHandlers, TrustHarness } from "../src/Harness.model.ts";
import { TurnId } from "../src/ids.ts";

const UnconfiguredWorkerWorld = TrustHarness.layer(HarnessHandlers).pipe(
  Layer.provide(
    Layer.mergeAll(
      FailClosedWorkerJudge,
      FailClosedWorkerExecutor,
      FailClosedWorkerCritic,
      Domain.InMemory,
    ),
  ),
);

it.live("Cloudflare worker default adapters fail closed when wasm bindings are not configured", () =>
  Effect.gen(function* () {
    const client = yield* TrustHarnessApi.clientInProcess;
    const tid = TurnId.make("worker-fail-closed-1");
    yield* client.SubmitTurn(tid, {
      preflight: {
        max_total_bytes: 1024,
        max_part_bytes: 512,
        parts: [{ id: "u1", kind: "text", source: "user", text: "hi" }],
      },
      toolCalls: [],
      verdict: { fields: [{ id: "tests_passed", claimed: "1", found: "1", anchored: true }] },
    });

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const receipt = yield* client.TurnReceipt.get(tid);
      if (receipt && receipt.outcome !== "pending") {
        expect(receipt.outcome).toBe("blocked");
        expect(receipt.blockedAt).toBe("preflight");
        expect(receipt.blockedReason).toContain("fail-closed:");
        return;
      }
      yield* Effect.sleep("5 millis");
    }
    throw new Error("timed out waiting for fail-closed worker receipt");
  }).pipe(Effect.scoped, Effect.provide(UnconfiguredWorkerWorld)),
);
