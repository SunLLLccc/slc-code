// Runtime integration tests — verify P13 wiring of plan mode, contextModifiers, and askUser

import { describe, it, expect, beforeEach, vi } from "vitest";
import { query } from "../../src/engine/query.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { buildTool, type ToolContext, type ToolInput, type ToolOutput } from "../../src/tools/base.js";
import { createPermissionChecker } from "../../src/permissions/checker.js";
import { scheduleToolCalls, type ToolCall } from "../../src/tools/scheduler.js";
import {
  setPlanModeState,
  resetPlanModeState,
  getPlanModeState,
  getRuntimePermissionMode,
} from "../../src/tools/builtin/plan-mode.js";
import {
  resetWorktreeState,
} from "../../src/tools/builtin/worktree-state.js";
import type { Provider } from "../../src/engine/providers/base.js";
import type { StreamEvent } from "../../src/engine/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>, finalText = "done"): Provider {
  let round = 0;
  return {
    name: "test",
    capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
    async *chat() {
      round++;
      if (round === 1 && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          yield { type: "tool_call_start" as const, id: tc.id, name: tc.name };
          yield { type: "tool_call_args" as const, id: tc.id, args_json: JSON.stringify(tc.args) };
        }
      } else {
        yield { type: "text_delta" as const, text: finalText };
        yield { type: "done" as const, reason: "completed" as const };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Issue 1+2: Plan mode permission chain integration
// ---------------------------------------------------------------------------

describe("plan mode permission integration", () => {
  beforeEach(() => {
    resetPlanModeState();
  });

  it("getRuntimePermissionMode returns baseMode when plan not active", () => {
    setPlanModeState({ baseMode: "acceptEdits" });
    expect(getRuntimePermissionMode()).toBe("acceptEdits");
  });

  it("getRuntimePermissionMode returns 'plan' when plan is active", () => {
    setPlanModeState({ active: true, baseMode: "acceptEdits" });
    expect(getRuntimePermissionMode()).toBe("plan");
  });

  it("permission checker with getRuntimeMode denies write tools in plan mode", () => {
    setPlanModeState({ active: true, baseMode: "default" });

    const checker = createPermissionChecker({
      mode: "default",
      rules: [],
      projectRoot: "/tmp",
      getRuntimeMode: () => getRuntimePermissionMode() as any,
    });

    const writeTool = buildTool({
      name: "FileWrite",
      description: "Write a file",
      schema: { input: { type: "object" } },
      security: { readOnly: false, concurrencySafe: false, destructive: true },
      execute: async () => ({ output: "written" }),
    });

    const ctx: ToolContext = { cwd: "/tmp" };
    expect(checker(writeTool, {}, ctx)).toBe("deny");
  });

  it("permission checker with getRuntimeMode allows read tools in plan mode", () => {
    setPlanModeState({ active: true, baseMode: "default" });

    const checker = createPermissionChecker({
      mode: "default",
      rules: [],
      projectRoot: "/tmp",
      getRuntimeMode: () => getRuntimePermissionMode() as any,
    });

    const readTool = buildTool({
      name: "FileRead",
      description: "Read a file",
      schema: { input: { type: "object" } },
      security: { readOnly: true, concurrencySafe: true, destructive: false },
      execute: async () => ({ output: "content" }),
    });

    const ctx: ToolContext = { cwd: "/tmp" };
    expect(checker(readTool, {}, ctx)).toBe("allow");
  });

  it("permission checker restores to acceptEdits after /unplan", () => {
    // Simulate /plan with acceptEdits mode
    setPlanModeState({ active: true, previousMode: "acceptEdits", baseMode: "acceptEdits" });

    const checker = createPermissionChecker({
      mode: "default",
      rules: [],
      projectRoot: "/tmp",
      getRuntimeMode: () => getRuntimePermissionMode() as any,
    });

    const fileTool = buildTool({
      name: "FileWrite",
      description: "Write a file",
      schema: { input: { type: "object" } },
      security: { readOnly: false, concurrencySafe: false, destructive: true },
      execute: async () => ({ output: "written" }),
    });

    const ctx: ToolContext = { cwd: "/tmp" };

    // In plan mode: deny
    expect(checker(fileTool, {}, ctx)).toBe("deny");

    // Simulate /unplan
    setPlanModeState({ active: false, baseMode: "acceptEdits" });

    // In acceptEdits mode: File tools should be allowed
    expect(checker(fileTool, {}, ctx)).toBe("allow");
  });

  it("permission checker denies non-file write tools in acceptEdits mode", () => {
    setPlanModeState({ active: false, baseMode: "acceptEdits" });

    const checker = createPermissionChecker({
      mode: "default",
      rules: [],
      projectRoot: "/tmp",
      getRuntimeMode: () => getRuntimePermissionMode() as any,
    });

    const bashTool = buildTool({
      name: "Bash",
      description: "Run a command",
      schema: { input: { type: "object" } },
      security: { readOnly: false, concurrencySafe: false, destructive: true },
      execute: async () => ({ output: "ok" }),
    });

    const ctx: ToolContext = { cwd: "/tmp" };
    // acceptEdits: non-file tools still ask
    expect(checker(bashTool, {}, ctx)).toBe("ask");
  });
});

// ---------------------------------------------------------------------------
// Issue 4+5: contextModifier.cwd application in query loop
// ---------------------------------------------------------------------------

describe("contextModifier.cwd application", () => {
  beforeEach(() => {
    resetWorktreeState();
  });

  it("query loop applies cwd contextModifier to toolContext for subsequent tool calls", async () => {
    const capturedContexts: ToolContext[] = [];

    const registry = new ToolRegistry();
    registry.registerBuiltin(buildTool({
      name: "EnterWorktree",
      description: "Enter a worktree",
      schema: { input: { type: "object", properties: { name: { type: "string" } } } },
      security: { readOnly: false, concurrencySafe: false, destructive: false },
      execute: async (_input: ToolInput, ctx: ToolContext): Promise<ToolOutput> => {
        capturedContexts.push({ ...ctx });
        return {
          output: "Entered worktree",
          contextModifier: { cwd: "/new/worktree/path" },
        };
      },
    }));

    registry.registerBuiltin(buildTool({
      name: "FileRead",
      description: "Read a file",
      schema: { input: { type: "object", properties: { path: { type: "string" } } } },
      security: { readOnly: true, concurrencySafe: true, destructive: false },
      execute: async (_input: ToolInput, ctx: ToolContext): Promise<ToolOutput> => {
        capturedContexts.push({ ...ctx });
        return { output: "file content" };
      },
    }));

    let round = 0;
    const provider: Provider = {
      name: "ctx-test",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat() {
        round++;
        if (round === 1) {
          // Both tool calls in the same round
          yield { type: "tool_call_start" as const, id: "tc-1", name: "EnterWorktree" };
          yield { type: "tool_call_args" as const, id: "tc-1", args_json: '{"name":"my-wt"}' };
          yield { type: "tool_call_start" as const, id: "tc-2", name: "FileRead" };
          yield { type: "tool_call_args" as const, id: "tc-2", args_json: '{"path":"test.txt"}' };
        } else {
          yield { type: "text_delta" as const, text: "done" };
          yield { type: "done" as const, reason: "completed" as const };
        }
      },
    };

    const toolContext: ToolContext = { cwd: "/original" };
    const events: StreamEvent[] = [];
    for await (const event of query(provider, [], {
      toolRegistry: registry,
      tools: registry.toProviderTools(),
      toolContext,
    })) {
      events.push(event);
    }

    // After the batch, toolContext.cwd should be updated
    expect(toolContext.cwd).toBe("/new/worktree/path");

    // Both tools saw the original cwd (they ran in the same parallel batch)
    expect(capturedContexts[0].cwd).toBe("/original");
    expect(capturedContexts[1].cwd).toBe("/original");
  });

  it("query loop applies cwd contextModifier across turns", async () => {
    const capturedContexts: ToolContext[] = [];

    const registry = new ToolRegistry();
    registry.registerBuiltin(buildTool({
      name: "SwitchDir",
      description: "Switch directory",
      schema: { input: { type: "object" } },
      security: { readOnly: true, concurrencySafe: true, destructive: false },
      execute: async (_input: ToolInput, ctx: ToolContext): Promise<ToolOutput> => {
        capturedContexts.push({ ...ctx });
        return {
          output: "Switched",
          contextModifier: { cwd: "/second/dir" },
        };
      },
    }));

    let round = 0;
    const provider: Provider = {
      name: "multi-turn",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat() {
        round++;
        if (round === 1) {
          yield { type: "tool_call_start" as const, id: "tc-1", name: "SwitchDir" };
          yield { type: "tool_call_args" as const, id: "tc-1", args_json: "{}" };
        } else if (round === 2) {
          // Second round: another tool call — should see updated cwd
          yield { type: "tool_call_start" as const, id: "tc-2", name: "SwitchDir" };
          yield { type: "tool_call_args" as const, id: "tc-2", args_json: "{}" };
        } else {
          yield { type: "text_delta" as const, text: "done" };
          yield { type: "done" as const, reason: "completed" as const };
        }
      },
    };

    const toolContext: ToolContext = { cwd: "/first" };
    const events: StreamEvent[] = [];
    for await (const event of query(provider, [], {
      toolRegistry: registry,
      tools: registry.toProviderTools(),
      toolContext,
    })) {
      events.push(event);
    }

    // First call saw /first, second call saw /second/dir
    expect(capturedContexts[0].cwd).toBe("/first");
    expect(capturedContexts[1].cwd).toBe("/second/dir");
    expect(toolContext.cwd).toBe("/second/dir");
  });
});

// ---------------------------------------------------------------------------
// Issue 4: Worktree state — previousCwd is now in contextModifier, not singleton
// ---------------------------------------------------------------------------

describe("worktree previousCwd via contextModifier", () => {
  it("previousCwd flows through contextModifier across tool calls in query loop", async () => {
    const capturedContexts: ToolContext[] = [];
    const capturedModifiers: Array<Record<string, unknown>> = [];

    const registry = new ToolRegistry();
    registry.registerBuiltin(buildTool({
      name: "EnterWorktree",
      description: "Enter a worktree",
      schema: { input: { type: "object", properties: { name: { type: "string" } } } },
      security: { readOnly: false, concurrencySafe: false, destructive: false },
      execute: async (_input: ToolInput, ctx: ToolContext): Promise<ToolOutput> => {
        capturedContexts.push({ ...ctx });
        const mod = { cwd: "/new/worktree/path", previousCwd: ctx.cwd };
        capturedModifiers.push(mod);
        return {
          output: "Entered worktree",
          contextModifier: mod,
        };
      },
    }));

    registry.registerBuiltin(buildTool({
      name: "ExitWorktree",
      description: "Exit a worktree",
      schema: { input: { type: "object", properties: { action: { type: "string" } } } },
      security: { readOnly: false, concurrencySafe: false, destructive: false },
      execute: async (_input: ToolInput, ctx: ToolContext): Promise<ToolOutput> => {
        capturedContexts.push({ ...ctx });
        const prevCwd = (ctx as unknown as Record<string, unknown>).previousCwd as string ?? ctx.cwd;
        return {
          output: `Restored to: ${prevCwd}`,
          contextModifier: { cwd: prevCwd, previousCwd: undefined },
        };
      },
    }));

    let round = 0;
    const provider: Provider = {
      name: "wt-test",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat() {
        round++;
        if (round === 1) {
          yield { type: "tool_call_start" as const, id: "tc-1", name: "EnterWorktree" };
          yield { type: "tool_call_args" as const, id: "tc-1", args_json: '{"name":"my-wt"}' };
        } else if (round === 2) {
          yield { type: "tool_call_start" as const, id: "tc-2", name: "ExitWorktree" };
          yield { type: "tool_call_args" as const, id: "tc-2", args_json: '{"action":"keep"}' };
        } else {
          yield { type: "text_delta" as const, text: "done" };
          yield { type: "done" as const, reason: "completed" as const };
        }
      },
    };

    const toolContext: ToolContext = { cwd: "/original/project" };
    const events: StreamEvent[] = [];
    for await (const event of query(provider, [], {
      toolRegistry: registry,
      tools: registry.toProviderTools(),
      toolContext,
    })) {
      events.push(event);
    }

    // EnterWorktree captured the original cwd
    expect(capturedContexts[0].cwd).toBe("/original/project");

    // EnterWorktree's modifier stored the original cwd as previousCwd
    expect(capturedModifiers[0].previousCwd).toBe("/original/project");
    expect(capturedModifiers[0].cwd).toBe("/new/worktree/path");

    // ExitWorktree should have seen the updated cwd and previousCwd
    expect(capturedContexts[1].cwd).toBe("/new/worktree/path");
    expect((capturedContexts[1] as unknown as Record<string, unknown>).previousCwd).toBe("/original/project");

    // After ExitWorktree, cwd restored to original
    expect(toolContext.cwd).toBe("/original/project");
  });

  it("Engine A enter worktree does not affect Engine B (no shared singleton)", async () => {
    // This test proves that two separate toolContext instances are isolated.
    // Previously, a module-level `previousCwd` would leak between engines.

    const registryA = new ToolRegistry();
    registryA.registerBuiltin(buildTool({
      name: "EnterWorktree",
      description: "Enter a worktree",
      schema: { input: { type: "object", properties: { name: { type: "string" } } } },
      security: { readOnly: false, concurrencySafe: false, destructive: false },
      execute: async (_input: ToolInput, ctx: ToolContext): Promise<ToolOutput> => ({
        output: "Entered worktree",
        contextModifier: { cwd: "/wt-a", previousCwd: ctx.cwd },
      }),
    }));

    const registryB = new ToolRegistry();
    registryB.registerBuiltin(buildTool({
      name: "EnterWorktree",
      description: "Enter a worktree",
      schema: { input: { type: "object", properties: { name: { type: "string" } } } },
      security: { readOnly: false, concurrencySafe: false, destructive: false },
      execute: async (_input: ToolInput, ctx: ToolContext): Promise<ToolOutput> => ({
        output: "Entered worktree",
        contextModifier: { cwd: "/wt-b", previousCwd: ctx.cwd },
      }),
    }));

    // Engine A
    const contextA: ToolContext = { cwd: "/project-a" };
    let roundA = 0;
    const providerA: Provider = {
      name: "eng-a",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat() {
        roundA++;
        if (roundA === 1) {
          yield { type: "tool_call_start" as const, id: "a-1", name: "EnterWorktree" };
          yield { type: "tool_call_args" as const, id: "a-1", args_json: '{"name":"wt-a"}' };
        } else {
          yield { type: "text_delta" as const, text: "done" };
          yield { type: "done" as const, reason: "completed" as const };
        }
      },
    };
    for await (const _ of query(providerA, [], { toolRegistry: registryA, tools: registryA.toProviderTools(), toolContext: contextA })) {
      // drain
    }

    // Engine B
    const contextB: ToolContext = { cwd: "/project-b" };
    let roundB = 0;
    const providerB: Provider = {
      name: "eng-b",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat() {
        roundB++;
        if (roundB === 1) {
          yield { type: "tool_call_start" as const, id: "b-1", name: "EnterWorktree" };
          yield { type: "tool_call_args" as const, id: "b-1", args_json: '{"name":"wt-b"}' };
        } else {
          yield { type: "text_delta" as const, text: "done" };
          yield { type: "done" as const, reason: "completed" as const };
        }
      },
    };
    for await (const _ of query(providerB, [], { toolRegistry: registryB, tools: registryB.toProviderTools(), toolContext: contextB })) {
      // drain
    }

    // Each engine's context should reflect only its own worktree change
    expect(contextA.cwd).toBe("/wt-a");
    expect((contextA as Record<string, unknown>).previousCwd).toBe("/project-a");

    expect(contextB.cwd).toBe("/wt-b");
    expect((contextB as Record<string, unknown>).previousCwd).toBe("/project-b");

    // No cross-contamination
    expect((contextA as Record<string, unknown>).previousCwd).not.toBe("/project-b");
    expect((contextB as Record<string, unknown>).previousCwd).not.toBe("/project-a");
  });
});

// ---------------------------------------------------------------------------
// Issue 3: AskUser callback on ToolContext
// ---------------------------------------------------------------------------

describe("AskUser on ToolContext", () => {
  it("ToolContext accepts askUser callback", async () => {
    const tool = buildTool({
      name: "TestAsk",
      description: "test",
      schema: { input: { type: "object", properties: { q: { type: "string" } } } },
      security: { readOnly: true, concurrencySafe: true, destructive: false },
      execute: async (_input: ToolInput, ctx: ToolContext): Promise<ToolOutput> => {
        if (!ctx.askUser) return { output: "no callback", isError: true };
        const answers = await ctx.askUser(["What?"]);
        return { output: answers[0] };
      },
    });

    const ctx: ToolContext = {
      cwd: "/tmp",
      askUser: async (questions: string[]) => questions.map(() => "answer"),
    };

    const result = await tool.execute({ q: "test" }, ctx);
    expect(result.output).toBe("answer");
    expect(result.isError).toBeUndefined();
  });

  it("ToolContext without askUser returns error from AskUser-like tool", async () => {
    const tool = buildTool({
      name: "TestAsk",
      description: "test",
      schema: { input: { type: "object" } },
      security: { readOnly: true, concurrencySafe: true, destructive: false },
      execute: async (_input: ToolInput, ctx: ToolContext): Promise<ToolOutput> => {
        if (!ctx.askUser) return { output: "no callback", isError: true };
        return { output: "ok" };
      },
    });

    const ctx: ToolContext = { cwd: "/tmp" };
    const result = await tool.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toBe("no callback");
  });
});

// ---------------------------------------------------------------------------
// Full scheduler + permissionChecker integration: plan mode blocks write tools
// ---------------------------------------------------------------------------

describe("scheduler + plan mode integration", () => {
  beforeEach(() => {
    resetPlanModeState();
  });

  it("plan mode: scheduleToolCalls denies FileWrite via permissionChecker", async () => {
    setPlanModeState({ active: true, baseMode: "default" });

    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    const registry = new ToolRegistry();
    registry.registerBuiltin(buildTool({
      name: "FileWrite",
      description: "Write a file",
      schema: { input: { type: "object", properties: { path: { type: "string" } } } },
      security: { readOnly: false, concurrencySafe: false, destructive: true },
      execute: executeSpy,
    }));

    const checker = createPermissionChecker({
      mode: "default",
      rules: [],
      projectRoot: "/tmp",
      getRuntimeMode: () => getRuntimePermissionMode() as any,
    });

    const call: ToolCall = { id: "tc-1", name: "FileWrite", arguments: '{"path":"/tmp/x"}' };
    const { results } = await scheduleToolCalls([call], registry, { cwd: "/tmp" }, checker);

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("denied");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("plan mode: scheduleToolCalls allows FileRead via permissionChecker", async () => {
    setPlanModeState({ active: true, baseMode: "default" });

    const executeSpy = vi.fn().mockResolvedValue({ output: "file content" });
    const registry = new ToolRegistry();
    registry.registerBuiltin(buildTool({
      name: "FileRead",
      description: "Read a file",
      schema: { input: { type: "object", properties: { path: { type: "string" } } } },
      security: { readOnly: true, concurrencySafe: true, destructive: false },
      execute: executeSpy,
    }));

    const checker = createPermissionChecker({
      mode: "default",
      rules: [],
      projectRoot: "/tmp",
      getRuntimeMode: () => getRuntimePermissionMode() as any,
    });

    const call: ToolCall = { id: "tc-2", name: "FileRead", arguments: '{"path":"/tmp/x"}' };
    const { results } = await scheduleToolCalls([call], registry, { cwd: "/tmp" }, checker);

    expect(results[0].output.isError).toBeFalsy();
    expect(executeSpy).toHaveBeenCalledOnce();
  });

  it("after /unplan: scheduleToolCalls allows FileWrite with acceptEdits mode", async () => {
    // Start in plan mode
    setPlanModeState({ active: true, baseMode: "acceptEdits" });

    const executeSpy = vi.fn().mockResolvedValue({ output: "written" });
    const registry = new ToolRegistry();
    registry.registerBuiltin(buildTool({
      name: "FileWrite",
      description: "Write a file",
      schema: { input: { type: "object", properties: { path: { type: "string" } } } },
      security: { readOnly: false, concurrencySafe: false, destructive: true },
      execute: executeSpy,
    }));

    // Checker with plan mode active — denies
    const checkerPlan = createPermissionChecker({
      mode: "default",
      rules: [],
      projectRoot: "/tmp",
      getRuntimeMode: () => getRuntimePermissionMode() as any,
    });

    const call1: ToolCall = { id: "tc-3a", name: "FileWrite", arguments: '{"path":"/tmp/x"}' };
    const { results: planResults } = await scheduleToolCalls([call1], registry, { cwd: "/tmp" }, checkerPlan);
    expect(planResults[0].output.isError).toBe(true);
    expect(executeSpy).not.toHaveBeenCalled();

    // Simulate /unplan — in real REPL, permissionChecker is rebuilt with new mode
    setPlanModeState({ active: false, baseMode: "acceptEdits" });

    // New checker with acceptEdits mode (as REPL would create after /unplan)
    const checkerUnplan = createPermissionChecker({
      mode: "acceptEdits",
      rules: [],
      projectRoot: "/tmp",
      getRuntimeMode: () => getRuntimePermissionMode() as any,
    });

    const call2: ToolCall = { id: "tc-3b", name: "FileWrite", arguments: '{"path":"/tmp/x"}' };
    const { results: unplanResults } = await scheduleToolCalls([call2], registry, { cwd: "/tmp" }, checkerUnplan);
    expect(unplanResults[0].output.isError).toBeFalsy();
    expect(executeSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Issue 3: EnterPlanMode previousMode from ToolContext permissionMode
// ---------------------------------------------------------------------------

describe("EnterPlanMode previousMode from ToolContext", () => {
  beforeEach(() => {
    resetPlanModeState();
  });

  it("base mode acceptEdits → EnterPlanMode → FileWrite denied → ExitPlanMode → FileWrite allowed", async () => {
    const fileWriteSpy = vi.fn().mockResolvedValue({ output: "written" });
    const registry = new ToolRegistry();

    registry.registerBuiltin(buildTool({
      name: "EnterPlanMode",
      description: "Enter plan mode",
      schema: { input: { type: "object" } },
      security: { readOnly: true, concurrencySafe: true, destructive: false },
      execute: async (_input: ToolInput, ctx: ToolContext): Promise<ToolOutput> => {
        setPlanModeState({ active: true, previousMode: ctx.permissionMode ?? "default", baseMode: ctx.permissionMode ?? "default" });
        return {
          output: `Entered plan mode. Previous mode: ${ctx.permissionMode}`,
          contextModifier: { permissionMode: "plan" },
        };
      },
    }));

    registry.registerBuiltin(buildTool({
      name: "ExitPlanMode",
      description: "Exit plan mode",
      schema: { input: { type: "object" } },
      security: { readOnly: true, concurrencySafe: true, destructive: false },
      execute: async (_input: ToolInput, _ctx: ToolContext): Promise<ToolOutput> => {
        const state = getPlanModeState();
        const restoredMode = state.previousMode ?? "default";
        setPlanModeState({ active: false });
        return {
          output: `Exited plan mode. Restored: ${restoredMode}`,
          contextModifier: { permissionMode: restoredMode },
        };
      },
    }));

    registry.registerBuiltin(buildTool({
      name: "FileWrite",
      description: "Write a file",
      schema: { input: { type: "object", properties: { path: { type: "string" } } } },
      security: { readOnly: false, concurrencySafe: false, destructive: true },
      execute: fileWriteSpy,
    }));

    const permissionChecker = createPermissionChecker({
      mode: "acceptEdits",
      rules: [],
      projectRoot: "/tmp",
      getRuntimeMode: () => getRuntimePermissionMode() as any,
    });

    // Round 1: EnterPlanMode + FileWrite (in same batch)
    // Round 2: ExitPlanMode
    // Round 3: FileWrite (should be allowed now)
    let round = 0;
    const provider: Provider = {
      name: "plan-test",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat() {
        round++;
        if (round === 1) {
          yield { type: "tool_call_start" as const, id: "tc-1", name: "EnterPlanMode" };
          yield { type: "tool_call_args" as const, id: "tc-1", args_json: "{}" };
          yield { type: "tool_call_start" as const, id: "tc-2", name: "FileWrite" };
          yield { type: "tool_call_args" as const, id: "tc-2", args_json: '{"path":"/tmp/x"}' };
        } else if (round === 2) {
          yield { type: "tool_call_start" as const, id: "tc-3", name: "ExitPlanMode" };
          yield { type: "tool_call_args" as const, id: "tc-3", args_json: "{}" };
        } else if (round === 3) {
          yield { type: "tool_call_start" as const, id: "tc-4", name: "FileWrite" };
          yield { type: "tool_call_args" as const, id: "tc-4", args_json: '{"path":"/tmp/y"}' };
        } else {
          yield { type: "text_delta" as const, text: "done" };
          yield { type: "done" as const, reason: "completed" as const };
        }
      },
    };

    const toolContext: ToolContext = { cwd: "/tmp", permissionMode: "acceptEdits" };
    const events: StreamEvent[] = [];
    for await (const event of query(provider, [], {
      toolRegistry: registry,
      tools: registry.toProviderTools(),
      toolContext,
      permissionChecker,
    })) {
      events.push(event);
    }

    // Collect tool result events
    const toolResults = events.filter((e) => e.type === "tool_call_result");

    // Round 1: EnterPlanMode succeeded, FileWrite was denied (plan mode active via getRuntimeMode)
    expect(toolResults[0].isError).toBeFalsy(); // EnterPlanMode
    expect(toolResults[1].isError).toBe(true); // FileWrite denied
    expect(toolResults[1].result).toContain("denied");

    // Round 2: ExitPlanMode succeeded
    expect(toolResults[2].isError).toBeFalsy();

    // Round 3: FileWrite should be allowed now (plan mode exited, back to acceptEdits)
    expect(toolResults[3].isError).toBeFalsy();
    expect(fileWriteSpy).toHaveBeenCalledOnce();

    // toolContext.permissionMode should be restored to acceptEdits
    expect(toolContext.permissionMode).toBe("acceptEdits");
  });
});
