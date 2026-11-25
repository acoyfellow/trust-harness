import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BoundaryName } from "../src/ids.ts";
import type { ClaimField } from "../src/schemas.ts";
import { loadPinnedBoundary, type JudgeHandle } from "../src/wasm/loader.ts";

export type ToolCallEvent = {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
};

export type ToolResultEvent = {
  readonly toolName: string;
  readonly resultText: string;
  readonly isError?: boolean;
};

export type ToolCallOutcome = { readonly block: true; readonly reason: string } | undefined;

export type ToolResultOutcome =
  | { readonly block: true; readonly reason: string; readonly status: string }
  | undefined;

export type PiToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly execute: (
    toolCallId: string,
    params: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }>;
};

export type PiExtensionHost = {
  on(event: "tool_call", handler: (event: ToolCallEvent) => Promise<ToolCallOutcome>): void;
  on(event: "tool_result", handler: (event: ToolResultEvent) => Promise<ToolResultOutcome>): void;
  registerTool(tool: PiToolDefinition): void;
};

export type ExtensionOptions = {
  readonly distDir?: string;
  readonly receiptPath?: string;
};

const defaultDistDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const GATED_TOOLS = new Set(["bash", "write", "edit"]);
const LOCKFILE_RE = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/i;

const recordReceipt = async (receiptPath: string | undefined, entry: Record<string, unknown>) => {
  if (!receiptPath) return;
  try {
    await appendFile(receiptPath, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, "utf8");
  } catch {
    return;
  }
};

const buildAdmitAction = (toolName: string, input: Record<string, unknown>) => {
  if (toolName === "bash") {
    return { kind: "bash", command: String(input.command ?? "") };
  }
  const targetPath = String(input.path ?? "");
  const text = toolName === "write" ? String(input.content ?? "") : JSON.stringify(input);
  if (LOCKFILE_RE.test(targetPath)) {
    return { kind: "lockfile", text };
  }
  if (toolName === "write") {
    return { kind: "write", path: targetPath, content: text };
  }
  return { kind: "edit", path: targetPath, payload: text };
};

export const createTrustHarnessExtension = (options: ExtensionOptions = {}) => {
  const distDir = options.distDir ?? process.env.TRUST_DIST_DIR ?? defaultDistDir;
  const receiptPath = options.receiptPath ?? process.env.TRUST_RECEIPTS;
  const cache = new Map<BoundaryName, JudgeHandle>();

  const load = (boundary: BoundaryName) => {
    const cached = cache.get(boundary);
    if (cached) return { ok: true as const, handle: cached };
    const loaded = loadPinnedBoundary(distDir, boundary);
    if (loaded.ok) cache.set(boundary, loaded.handle);
    return loaded;
  };

  return (pi: PiExtensionHost): void => {
    pi.on("tool_call", async (event) => {
      const loaded = load("admit");
      if (!loaded.ok) {
        const reason = `fail-closed: ${loaded.error.reason}`;
        await recordReceipt(receiptPath, {
          boundary: "admit",
          tool: event.toolName,
          allow: false,
          reason,
          wasmSha256: null,
        });
        return { block: true, reason };
      }

      if (!GATED_TOOLS.has(event.toolName)) {
        await recordReceipt(receiptPath, {
          boundary: "admit",
          tool: event.toolName,
          allow: true,
          reason: "tool allowed",
          wasmSha256: loaded.handle.sha256,
        });
        return undefined;
      }

      const action = buildAdmitAction(event.toolName, event.input);
      const reply = loaded.handle.evalJson(action) as { allow?: boolean; reason?: string; error?: string };
      const allow = reply.allow === true && !reply.error;
      const reason = reply.error ? `fail-closed: ${reply.error}` : String(reply.reason ?? "denied");

      await recordReceipt(receiptPath, {
        boundary: "admit",
        tool: event.toolName,
        allow,
        reason,
        wasmSha256: loaded.handle.sha256,
      });

      if (!allow) return { block: true, reason };
      return undefined;
    });

    pi.on("tool_result", async (event) => {
      const loaded = load("observe");
      if (!loaded.ok) {
        const reason = `fail-closed: ${loaded.error.reason}`;
        await recordReceipt(receiptPath, {
          boundary: "observe",
          tool: event.toolName,
          allow: false,
          reason,
          wasmSha256: null,
        });
        return { block: true, reason, status: "fail-closed" };
      }

      const reply = loaded.handle.evalJson({
        service: event.toolName,
        http_status: event.isError ? 500 : 200,
        claimed_success: !event.isError,
        observed_proof: !event.isError,
        terminal_fault: event.isError ? "tool-error" : "none",
        retrieval_authority: "none",
        retrieved_text: event.resultText,
      }) as { allow?: boolean; status?: string; reason?: string; error?: string };

      const allow = reply.allow === true && !reply.error;
      const status = String(reply.status ?? "invalid");
      const reason = reply.error ? `fail-closed: ${reply.error}` : String(reply.reason ?? "untrusted");

      await recordReceipt(receiptPath, {
        boundary: "observe",
        tool: event.toolName,
        allow,
        status,
        reason,
        wasmSha256: loaded.handle.sha256,
      });

      if (!allow) return { block: true, reason, status };
      return undefined;
    });

    pi.registerTool({
      name: "trust_disprove",
      description: "Verify claimed fields with pinned verdict.wasm and test whether a counterexample disproves the turn.",
      parameters: {
        type: "object",
        properties: {
          fields: { type: "array" },
          counterexampleFields: { type: "array" },
        },
        required: ["fields"],
      },
      execute: async (_toolCallId, params) => {
        const loaded = load("verdict");
        if (!loaded.ok) {
          const details = {
            outcome: "blocked",
            disproofVerified: false,
            reason: `fail-closed: ${loaded.error.reason}`,
            wasmSha256: null,
          };
          await recordReceipt(receiptPath, { boundary: "verdict", ...details });
          return { content: [{ type: "text", text: JSON.stringify(details) }], details };
        }

        const fields = Array.isArray(params.fields) ? (params.fields as ClaimField[]) : [];
        const counterexampleFields = Array.isArray(params.counterexampleFields)
          ? (params.counterexampleFields as ClaimField[])
          : [];

        const primary = loaded.handle.evalJson({ fields }) as {
          action?: string;
          held?: number;
          broken?: number;
          unbacked?: number;
          error?: string;
        };

        let outcome = primary.action === "pass" ? "passed" : String(primary.action ?? "blocked");
        let disproofVerified = false;

        if (primary.action === "pass" && counterexampleFields.length > 0) {
          const challenge = loaded.handle.evalJson({ fields: counterexampleFields }) as { action?: string };
          if (challenge.action !== "pass") {
            disproofVerified = true;
            outcome = "disproven";
          }
        }

        const details = {
          outcome,
          disproofVerified,
          primary,
          wasmSha256: loaded.handle.sha256,
        };
        await recordReceipt(receiptPath, { boundary: "verdict", ...details });
        return { content: [{ type: "text", text: JSON.stringify(details) }], details };
      },
    });
  };
};

export default createTrustHarnessExtension();
