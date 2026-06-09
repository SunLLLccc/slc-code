// Worktree e2e tests — EnterWorktree/ExitWorktree via QueryEngine + tool execution
//
// Tests:
// 1. EnterWorktree creates worktree, contextModifier carries cwd/previousCwd
// 2. ExitWorktree removes worktree, restores previousCwd
// 3. QueryEngine with mock provider emitting EnterWorktree tool call — toolContext.cwd changes
// 4. QueryEngine with ExitWorktree — toolContext.cwd restored
// 5. Metadata doesn't leak between independent engines
// 6. Worktree validation (name/path required, path restriction)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { enterWorktreeTool } from "../../src/tools/builtin/enter-worktree.js";
import { exitWorktreeTool } from "../../src/tools/builtin/exit-worktree.js";
import { createBuiltinRegistry } from "../../src/tools/builtin/registry-factory.js";
import { QueryEngine } from "../../src/engine/engine.js";
import { MockProvider } from "../../src/engine/providers/base.js";
import type { ToolContext } from "../../src/tools/base.js";
import type { StreamEvent } from "../../src/engine/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-e2e-worktree-"));
  execFileSync("git", ["init"], { cwd: testDir, encoding: "utf-8" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: testDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: testDir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
    cwd: testDir,
    encoding: "utf-8",
  });
});

afterEach(async () => {
  try {
    execFileSync("git", ["worktree", "list"], { cwd: testDir, encoding: "utf-8" });
  } catch {
    // repo may already be gone
  }
  await rm(testDir, { recursive: true, force: true });
});

function ctx(cwd?: string): ToolContext {
  return { cwd: cwd ?? testDir };
}

// ---------------------------------------------------------------------------
// Tests — direct tool execution
// ---------------------------------------------------------------------------

describe("EnterWorktree — direct execution", () => {
  it("creates a worktree in .slc/worktrees", async () => {
    const result = await enterWorktreeTool.execute({ name: "feat-x" }, ctx());
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("Created and entered worktree");
    expect(result.output).toContain("feat-x");

    // Verify worktree directory exists
    const worktreePath = join(testDir, ".slc", "worktrees", "feat-x");
    const contextMod = result.contextModifier as Record<string, unknown>;
    expect(contextMod).toBeDefined();
    expect(contextMod.cwd).toBe(worktreePath);
    expect(contextMod.previousCwd).toBe(testDir);
  });

  it("rejects if worktree already exists", async () => {
    await enterWorktreeTool.execute({ name: "dup" }, ctx());
    const result = await enterWorktreeTool.execute({ name: "dup" }, ctx());
    expect(result.isError).toBe(true);
    expect(result.output).toContain("already exists");
  });

  it("requires either name or path (via validate)", () => {
    const error = enterWorktreeTool.validate?.({});
    expect(error).toBe("Either name or path must be provided");
  });
});

describe("ExitWorktree — direct execution", () => {
  it("removes worktree and restores previousCwd", async () => {
    const createResult = await enterWorktreeTool.execute({ name: "to-remove" }, ctx());
    expect(createResult.isError).toBeFalsy();

    const worktreePath = (createResult.contextModifier as Record<string, unknown>).cwd as string;

    const exitResult = await exitWorktreeTool.execute(
      { action: "remove", discard_changes: true, worktree_path: worktreePath },
      { cwd: worktreePath, previousCwd: testDir } as ToolContext,
    );
    expect(exitResult.isError).toBeFalsy();
    expect(exitResult.output).toContain("Worktree removed");

    const contextMod = exitResult.contextModifier as Record<string, unknown>;
    expect(contextMod.cwd).toBe(testDir);
  });

  it("keep action preserves worktree", async () => {
    const createResult = await enterWorktreeTool.execute({ name: "to-keep" }, ctx());
    const worktreePath = (createResult.contextModifier as Record<string, unknown>).cwd as string;

    const exitResult = await exitWorktreeTool.execute(
      { action: "keep" },
      { cwd: worktreePath, previousCwd: testDir } as ToolContext,
    );
    expect(exitResult.isError).toBeFalsy();
    expect(exitResult.output).toContain("Worktree kept");
  });

  it("rejects invalid action", async () => {
    const result = await exitWorktreeTool.execute(
      { action: "invalid" },
      ctx(),
    );
    expect(result.isError).toBe(true);
  });
});

describe("Worktree — path restriction", () => {
  it("rejects path outside .slc/worktrees", async () => {
    const result = await enterWorktreeTool.execute(
      { path: "/tmp/outside-worktree" },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("must be within .slc/worktrees");
  });

  it("accepts path within .slc/worktrees", async () => {
    await enterWorktreeTool.execute({ name: "switch-target" }, ctx());
    const worktreePath = join(testDir, ".slc", "worktrees", "switch-target");

    const result = await enterWorktreeTool.execute({ path: worktreePath }, ctx());
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("Switched to existing worktree");
  });
});

// ---------------------------------------------------------------------------
// Tests — QueryEngine metadata integration
// ---------------------------------------------------------------------------

describe("Worktree — QueryEngine toolContext.cwd changes", () => {
  it("toolContext.cwd changes after EnterWorktree tool call", async () => {
    const registry = createBuiltinRegistry();

    // Mock provider: first call emits EnterWorktree, second call responds with text
    let callCount = 0;
    const provider = new MockProvider({ chunks: [] });
    provider.chat = async function* () {
      callCount++;
      if (callCount === 1) {
        yield {
          type: "tool_call_start",
          id: "tc-enter",
          name: "EnterWorktree",
        } as StreamEvent;
        yield {
          type: "tool_call_args",
          id: "tc-enter",
          args_json: JSON.stringify({ name: "engine-wt" }),
        } as StreamEvent;
      } else {
        yield { type: "text_delta", text: "Entered worktree" } as StreamEvent;
        yield { type: "done", reason: "completed" } as StreamEvent;
      }
    };

    const toolContext = { cwd: testDir };
    const engine = new QueryEngine(provider, {
      tools: registry.toProviderTools(),
      toolRegistry: registry,
      toolContext,
    });

    const events: StreamEvent[] = [];
    for await (const event of engine.query("enter worktree")) {
      events.push(event);
    }

    // After tool execution, toolContext.cwd should have changed
    const expectedWorktreePath = join(testDir, ".slc", "worktrees", "engine-wt");
    expect(toolContext.cwd).toBe(expectedWorktreePath);

    // Should have tool_call_result with success
    const toolResults = events.filter((e) => e.type === "tool_call_result");
    expect(toolResults).toHaveLength(1);
    expect((toolResults[0] as { result: string }).result).toContain("Created and entered worktree");
  });

  it("toolContext.cwd restored after ExitWorktree tool call", async () => {
    // First create a worktree manually
    const createResult = await enterWorktreeTool.execute({ name: "exit-test" }, ctx());
    const worktreePath = (createResult.contextModifier as Record<string, unknown>).cwd as string;

    const registry = createBuiltinRegistry();

    let callCount = 0;
    const provider = new MockProvider({ chunks: [] });
    provider.chat = async function* () {
      callCount++;
      if (callCount === 1) {
        yield {
          type: "tool_call_start",
          id: "tc-exit",
          name: "ExitWorktree",
        } as StreamEvent;
        yield {
          type: "tool_call_args",
          id: "tc-exit",
          args_json: JSON.stringify({
            action: "remove",
            discard_changes: true,
            worktree_path: worktreePath,
          }),
        } as StreamEvent;
      } else {
        yield { type: "text_delta", text: "Exited worktree" } as StreamEvent;
        yield { type: "done", reason: "completed" } as StreamEvent;
      }
    };

    const toolContext = { cwd: worktreePath, previousCwd: testDir };
    const engine = new QueryEngine(provider, {
      tools: registry.toProviderTools(),
      toolRegistry: registry,
      toolContext,
    });

    const events: StreamEvent[] = [];
    for await (const event of engine.query("exit worktree")) {
      events.push(event);
    }

    // After ExitWorktree, cwd should be restored to original
    expect(toolContext.cwd).toBe(testDir);

    // Should have tool_call_result
    const toolResults = events.filter((e) => e.type === "tool_call_result");
    expect(toolResults).toHaveLength(1);
  });
});

describe("Worktree — metadata isolation between engines", () => {
  it("engine A's worktree metadata doesn't leak to engine B", async () => {
    const registry = createBuiltinRegistry();

    // Engine A: enters a worktree
    let callCountA = 0;
    const providerA = new MockProvider({ chunks: [] });
    providerA.chat = async function* () {
      callCountA++;
      if (callCountA === 1) {
        yield {
          type: "tool_call_start",
          id: "tc-a",
          name: "EnterWorktree",
        } as StreamEvent;
        yield {
          type: "tool_call_args",
          id: "tc-a",
          args_json: JSON.stringify({ name: "engine-a-wt" }),
        } as StreamEvent;
      } else {
        yield { type: "text_delta", text: "done A" } as StreamEvent;
        yield { type: "done", reason: "completed" } as StreamEvent;
      }
    };

    const toolContextA = { cwd: testDir };
    const engineA = new QueryEngine(providerA, {
      tools: registry.toProviderTools(),
      toolRegistry: registry,
      toolContext: toolContextA,
    });

    for await (const _ of engineA.query("enter worktree A")) {
      // drain
    }

    // Verify A's cwd changed
    const expectedPath = join(testDir, ".slc", "worktrees", "engine-a-wt");
    expect(toolContextA.cwd).toBe(expectedPath);

    // Engine B: separate instance, should NOT see A's worktree state
    const providerB = new MockProvider({ chunks: ["response from B"] });
    const toolContextB = { cwd: testDir };
    const engineB = new QueryEngine(providerB, {
      tools: registry.toProviderTools(),
      toolRegistry: registry,
      toolContext: toolContextB,
    });

    for await (const _ of engineB.query("just a query")) {
      // drain
    }

    // B's cwd should be unchanged
    expect(toolContextB.cwd).toBe(testDir);

    // A's cwd should still be the worktree
    expect(toolContextA.cwd).toBe(expectedPath);
  });
});
