import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent,
  ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { BoundaryName } from "../src/ids.ts";
import type { ClaimField } from "../src/schemas.ts";
import { loadPinnedBoundary, type JudgeHandle } from "../src/wasm/loader.ts";

export type ExtensionOptions = {
  readonly distDir?: string;
  readonly receiptPath?: string;
};

const defaultDistDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const GATED_TOOLS = new Set(["bash", "write", "edit"]);
const LOCKFILE_RE = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/i;

const ClaimFieldSchema = Type.Object({
  id: Type.String(),
  claimed: Type.Union([Type.String(), Type.Null()]),
  found: Type.Union([Type.String(), Type.Null()]),
  anchored: Type.Boolean(),
});

type DisproveDetails = {
  readonly outcome: string;
  readonly disproofVerified: boolean;
  readonly reason: string;
  readonly wasmSha256: string | null;
  readonly primary?: {
    action?: string;
    held?: number;
    broken?: number;
    unbacked?: number;
    error?: string;
  };
};

const DisproveParamsSchema = Type.Object({
  fields: Type.Array(ClaimFieldSchema),
  counterexampleFields: Type.Optional(Type.Array(ClaimFieldSchema)),
});

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

const extractResultText = (event: ToolResultEvent): string => {
  const parts: string[] = [];
  for (const item of event.content) {
    if (item.type === "text") parts.push(item.text);
  }
  if (event.structuredContent !== undefined && event.structuredContent !== null) {
    parts.push(JSON.stringify(event.structuredContent));
  }
  return parts.join("\n");
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

  return (pi: ExtensionAPI): void => {
    pi.on("tool_call", async (event: ToolCallEvent): Promise<ToolCallEventResult | undefined> => {
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

      const action = buildAdmitAction(event.toolName, event.input as Record<string, unknown>);
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

    pi.on("tool_result", async (event: ToolResultEvent): Promise<ToolResultEventResult | undefined> => {
      const loaded = load("observe");
      if (!loaded.ok) {
        const reason = `fail-closed: ${loaded.error.reason}`;
        await recordReceipt(receiptPath, {
          boundary: "observe",
          tool: event.toolName,
          allow: false,
          status: "fail-closed",
          reason,
          wasmSha256: null,
        });
        return {
          content: [{ type: "text", text: `[trust-harness fail-closed] ${reason}` }],
          structuredContent: null,
          isError: true,
        };
      }

      const retrievedText = extractResultText(event);
      const reply = loaded.handle.evalJson({
        service: event.toolName,
        http_status: event.isError ? 500 : 200,
        claimed_success: !event.isError,
        observed_proof: !event.isError,
        terminal_fault: event.isError ? "tool-error" : "none",
        retrieval_authority: "none",
        retrieved_text: retrievedText,
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

      if (!allow) {
        return {
          content: [{ type: "text", text: `[trust-harness blocked ${status}] ${reason}` }],
          structuredContent: null,
          isError: true,
        };
      }
      return undefined;
    });

    pi.registerTool({
      name: "trust_disprove",
      label: "Trust Disprove",
      description: "Verify claimed fields with pinned verdict.wasm and test whether a counterexample disproves the turn.",
      parameters: DisproveParamsSchema,
      execute: async (_toolCallId, params) => {
        const loaded = load("verdict");
        if (!loaded.ok) {
          const details: DisproveDetails = {
            outcome: "blocked",
            disproofVerified: false,
            reason: `fail-closed: ${loaded.error.reason}`,
            wasmSha256: null,
          };
          await recordReceipt(receiptPath, { boundary: "verdict", ...details });
          return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
        }

        const fields: ClaimField[] = params.fields;
        const counterexampleFields: ClaimField[] = params.counterexampleFields ?? [];

        const primary = loaded.handle.evalJson({ fields }) as {
          action?: string;
          held?: number;
          broken?: number;
          unbacked?: number;
          error?: string;
        };

        let outcome = primary.action === "pass" ? "passed" : String(primary.action ?? "blocked");
        let disproofVerified = false;
        let reason = outcome;

        if (primary.action === "pass" && counterexampleFields.length > 0) {
          const challenge = loaded.handle.evalJson({ fields: counterexampleFields }) as { action?: string };
          if (challenge.action !== "pass") {
            disproofVerified = true;
            outcome = "disproven";
            reason = "counterexample verified by verdict.wasm";
          }
        }

        const details: DisproveDetails = {
          outcome,
          disproofVerified,
          reason,
          primary,
          wasmSha256: loaded.handle.sha256,
        };
        await recordReceipt(receiptPath, { boundary: "verdict", ...details });
        return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
      },
    });
  };
};

export default createTrustHarnessExtension();
