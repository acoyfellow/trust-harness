import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "@effect/vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const runExample = (relPath: string): unknown => {
  const stdout = execFileSync("node", [path.join(root, relPath)], {
    cwd: root,
    encoding: "utf8",
  });
  return JSON.parse(stdout);
};

it("examples/coding-agent-turn.ts executes allowed commit once and blocks bypass/lockfile at 0 executions", () => {
  const results = runExample("examples/coding-agent-turn.ts") as Array<{
    id: string;
    executedCalls: number;
    outcome: string;
  }>;
  expect(results).toEqual([
    expect.objectContaining({ id: "safe-attached-commit", executedCalls: 1, outcome: "passed", blockedAt: null }),
    expect.objectContaining({ id: "blocked-short-no-verify", executedCalls: 0, outcome: "blocked", blockedAt: "admit" }),
    expect.objectContaining({ id: "blocked-private-lockfile", executedCalls: 0, outcome: "blocked", blockedAt: "admit" }),
  ]);
});

it("examples/prompt-injection-redaction.ts blocks .env writes and redacts hostile tool_result content+structuredContent", () => {
  const out = runExample("examples/prompt-injection-redaction.ts") as {
    safeCallBlocked: boolean;
    envCallBlocked: boolean;
    cleanResultRedacted: boolean;
    hostileResult: { isError: boolean; structuredContent: unknown; content: Array<{ type: string; text: string }> };
  };
  expect(out.safeCallBlocked).toBe(false);
  expect(out.envCallBlocked).toBe(true);
  expect(out.cleanResultRedacted).toBe(false);
  expect(out.hostileResult.isError).toBe(true);
  expect(out.hostileResult.structuredContent).toBeNull();
  expect(out.hostileResult.content[0]?.text).toContain("hostile-retrieval");
});

it("examples/disproof-and-breaker.ts disproves false pass claims and catches 10/10 breaker attacks", () => {
  const out = runExample("examples/disproof-and-breaker.ts") as {
    disproofChallenge: { outcome: string; blockedAt: string; blockedReason: string };
    breakerRound: { totalAttacks: number; caught: number; disproofs: number };
  };
  expect(out.disproofChallenge.outcome).toBe("disproven");
  expect(out.disproofChallenge.blockedAt).toBe("verdict");
  expect(out.disproofChallenge.blockedReason).toContain("11");
  expect(out.breakerRound).toEqual({ totalAttacks: 10, caught: 10, disproofs: 0 });
});
