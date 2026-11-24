import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BoundaryName } from "../ids.ts";

export type JudgeHandle = {
  readonly boundary: BoundaryName;
  readonly sha256: string;
  readonly evalJson: (input: unknown) => unknown;
};

type WasmExports = {
  memory: WebAssembly.Memory;
  alloc: (len: number) => number;
  dealloc: (ptr: number, len: number) => void;
  eval: (ptr: number, len: number) => bigint;
};

export type LoadError = {
  readonly _tag: "WasmLoadError";
  readonly boundary: BoundaryName;
  readonly reason: string;
};

export type LoadResult =
  | { readonly ok: true; readonly handle: JudgeHandle }
  | { readonly ok: false; readonly error: LoadError };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export const parseManifest = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (match) out[match[2].trim()] = match[1].toLowerCase();
  }
  return out;
};

const fail = (boundary: BoundaryName, reason: string): LoadResult => ({
  ok: false,
  error: { _tag: "WasmLoadError", boundary, reason },
});

export const loadPinnedBoundary = (distDir: string, boundary: BoundaryName): LoadResult => {
  const manifestPath = path.join(distDir, "wasm.sha256");
  if (!existsSync(manifestPath)) {
    return fail(boundary, `manifest missing: ${manifestPath}`);
  }

  const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
  const fileName = `${boundary}.wasm`;
  const expected = manifest[fileName];
  if (!expected) {
    return fail(boundary, `manifest missing sha256 entry for ${fileName}`);
  }

  const wasmPath = path.join(distDir, fileName);
  if (!existsSync(wasmPath)) {
    return fail(boundary, `wasm artifact missing: ${wasmPath}`);
  }

  const bytes = new Uint8Array(readFileSync(wasmPath));
  const actual = sha256Of(bytes);
  if (actual !== expected) {
    return fail(boundary, `sha256 mismatch for ${fileName}: expected ${expected}, got ${actual}`);
  }

  let instance: WebAssembly.Instance;
  try {
    const module = new WebAssembly.Module(bytes);
    instance = new WebAssembly.Instance(module, {});
  } catch (cause) {
    return fail(boundary, `wasm instantiation failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const exports = instance.exports as Partial<WasmExports>;
  if (
    !(exports.memory instanceof WebAssembly.Memory) ||
    typeof exports.alloc !== "function" ||
    typeof exports.dealloc !== "function" ||
    typeof exports.eval !== "function"
  ) {
    return fail(boundary, `${fileName} missing required shared ABI exports (memory, alloc, dealloc, eval)`);
  }

  const memory = exports.memory;
  const alloc = exports.alloc;
  const dealloc = exports.dealloc;
  const evalFn = exports.eval;

  const evalJson = (input: unknown): unknown => {
    const payload = encoder.encode(JSON.stringify(input));
    const inPtr = alloc(payload.length);
    new Uint8Array(memory.buffer, inPtr, payload.length).set(payload);
    let packed: bigint;
    try {
      packed = evalFn(inPtr, payload.length);
    } finally {
      dealloc(inPtr, payload.length);
    }
    const outPtr = Number((packed >> 32n) & 0xffffffffn);
    const outLen = Number(packed & 0xffffffffn);
    const text = decoder.decode(new Uint8Array(memory.buffer, outPtr, outLen));
    dealloc(outPtr, outLen);
    return JSON.parse(text);
  };

  return { ok: true, handle: { boundary, sha256: actual, evalJson } };
};
