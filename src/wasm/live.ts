import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { BoundaryName } from "../ids.ts";
import {
  AdmitOutput,
  ObserveOutput,
  PreflightOutput,
  VerdictOutput,
} from "../schemas.ts";
import { WasmJudge, WasmJudgeUnavailable } from "../WasmJudge.external.ts";
import { loadPinnedBoundary, type JudgeHandle } from "./loader.ts";

const defaultDistDir = process.env.TRUST_DIST_DIR
  ? path.resolve(process.env.TRUST_DIST_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

const decodePreflight = Schema.decodeUnknownSync(PreflightOutput);
const decodeAdmit = Schema.decodeUnknownSync(AdmitOutput);
const decodeObserve = Schema.decodeUnknownSync(ObserveOutput);
const decodeVerdict = Schema.decodeUnknownSync(VerdictOutput);

const runBoundary = <Out>(
  distDir: string,
  cache: Map<BoundaryName, JudgeHandle>,
  boundary: BoundaryName,
  payload: unknown,
  decode: (value: unknown) => Out,
): Effect.Effect<Out, WasmJudgeUnavailable> =>
  Effect.suspend(() => {
    let handle = cache.get(boundary);
    if (!handle) {
      const loaded = loadPinnedBoundary(distDir, boundary);
      if (!loaded.ok) {
        return Effect.fail(new WasmJudgeUnavailable({ boundary, reason: loaded.error.reason }));
      }
      handle = loaded.handle;
      cache.set(boundary, handle);
    }
    try {
      const raw = handle.evalJson(payload);
      if (typeof raw !== "object" || raw === null || "error" in raw) {
        const message =
          typeof raw === "object" && raw !== null && "error" in raw
            ? String((raw as { error: unknown }).error)
            : "malformed wasm json reply";
        return Effect.fail(new WasmJudgeUnavailable({ boundary, reason: message }));
      }
      return Effect.succeed(decode({ ...(raw as Record<string, unknown>), wasmSha256: handle.sha256 }));
    } catch (cause) {
      return Effect.fail(
        new WasmJudgeUnavailable({
          boundary,
          reason: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
  });

export const makeWasmJudgeLayer = (distDir: string = defaultDistDir) => {
  const cache = new Map<BoundaryName, JudgeHandle>();
  return WasmJudge.toLayer(
    Effect.succeed({
      preflight: ({ input }) => runBoundary(distDir, cache, "preflight", input, decodePreflight),
      admit: ({ action }) => runBoundary(distDir, cache, "admit", action, decodeAdmit),
      observe: ({ input }) => runBoundary(distDir, cache, "observe", input, decodeObserve),
      verdict: ({ input }) => runBoundary(distDir, cache, "verdict", input, decodeVerdict),
    }),
  );
};

export const WasmJudgeLive = makeWasmJudgeLayer();
