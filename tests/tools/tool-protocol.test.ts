// Tests for Tool protocol, registry, and scheduler

import { describe, it, expect, vi } from "vitest";
import {
  buildTool,
  type Tool,
  type ToolInput,
  type ToolOutput,
  type ToolContext,
} from "../../src/tools/base.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import {
  partitionToolCalls,
  scheduleToolCalls,
  type ToolCall,
  type PreToolUseHook,
} from "../../src/tools/scheduler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CTX: ToolContext = { cwd: "/tmp" };

function makeTool(overrides: {
  name?: string;
  concurrencySafe?: boolean;
  readOnly?: boolean;
  execute?: (input: ToolInput) => Promise<ToolOutput>;
  validate?: (input: ToolInput) => string | undefined;
  checkPermissions?: (input: ToolInput, context: ToolContext) => "allow" | "deny" | "ask";
}): Tool {
  return buildTool({
    name: overrides.name ?? "test_tool",
    description: "A test tool",
    schema: {
      input: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
    },
    security: {
      concurrencySafe: overrides.concurrencySafe ?? false,
      readOnly: overrides.readOnly ?? false,
      destructive: true,
    },
    execute:
      overrides.execute ??
      (async (input) => ({
        output: `executed with value: ${input.value}`,
      })),
    validate: overrides.validate,
    checkPermissions: overrides.checkPermissions,
  });
}

function makeCall(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${name}`, name, arguments: JSON.stringify(args) };
}

// ---------------------------------------------------------------------------
// Tool interface & buildTool — fail-closed defaults
// ---------------------------------------------------------------------------

describe("buildTool fail-closed defaults", () => {
  it("defaults to non-read-only", () => {
    const tool = buildTool({
      name: "t",
      description: "d",
      schema: { input: { type: "object" } },
      execute: async () => ({ output: "ok" }),
    });
    expect(tool.security.readOnly).toBe(false);
  });

  it("defaults to non-concurrency-safe", () => {
    const tool = buildTool({
      name: "t",
      description: "d",
      schema: { input: { type: "object" } },
      execute: async () => ({ output: "ok" }),
    });
    expect(tool.security.concurrencySafe).toBe(false);
  });

  it("defaults to destructive", () => {
    const tool = buildTool({
      name: "t",
      description: "d",
      schema: { input: { type: "object" } },
      execute: async () => ({ output: "ok" }),
    });
    expect(tool.security.destructive).toBe(true);
  });

  it("allows explicit override of security defaults", () => {
    const tool = buildTool({
      name: "t",
      description: "d",
      schema: { input: { type: "object" } },
      execute: async () => ({ output: "ok" }),
      security: { readOnly: true, concurrencySafe: true, destructive: false },
    });
    expect(tool.security.readOnly).toBe(true);
    expect(tool.security.concurrencySafe).toBe(true);
    expect(tool.security.destructive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

describe("ToolRegistry", () => {
  it("registers and retrieves built-in tools", () => {
    const registry = new ToolRegistry();
    const tool = makeTool({ name: "read_file" });
    registry.registerBuiltin(tool);
    expect(registry.get("read_file")).toBe(tool);
  });

  it("built-in tools take priority over external tools", () => {
    const registry = new ToolRegistry();
    const builtin = makeTool({ name: "read_file" });
    const external = makeTool({ name: "read_file" });
    registry.registerBuiltin(builtin);
    registry.registerExternal(external);
    expect(registry.get("read_file")).toBe(builtin);
    expect(registry.get("read_file")).not.toBe(external);
  });

  it("external tools are ignored when built-in exists", () => {
    const registry = new ToolRegistry();
    const builtin = makeTool({ name: "grep" });
    registry.registerBuiltin(builtin);
    registry.registerExternal(makeTool({ name: "grep" }));
    expect(registry.list().length).toBe(1);
  });

  it("lists all tools (builtin first)", () => {
    const registry = new ToolRegistry();
    registry.registerExternal(makeTool({ name: "mcp_tool" }));
    registry.registerBuiltin(makeTool({ name: "read_file" }));
    const list = registry.list();
    expect(list.length).toBe(2);
    expect(list[0].name).toBe("read_file"); // builtin first
  });

  it("toProviderTools converts to provider format", () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(makeTool({ name: "read_file" }));
    const providerTools = registry.toProviderTools();
    expect(providerTools).toHaveLength(1);
    expect(providerTools[0].name).toBe("read_file");
    expect(providerTools[0].parameters).toBeDefined();
  });

  it("returns undefined for unknown tool", () => {
    const registry = new ToolRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
    expect(registry.has("nonexistent")).toBe(false);
  });

  it("registering builtin evicts previously registered external with same name", () => {
    const registry = new ToolRegistry();
    const external = makeTool({ name: "search" });
    registry.registerExternal(external);
    expect(registry.get("search")).toBe(external);
    expect(registry.list()).toHaveLength(1);

    // Now register builtin with same name
    const builtin = makeTool({ name: "search" });
    registry.registerBuiltin(builtin);

    // get() returns builtin
    expect(registry.get("search")).toBe(builtin);
    // list()/toProviderTools() only expose one tool (not two)
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toBe(builtin);
    expect(registry.toProviderTools()).toHaveLength(1);
    // listExternal should be empty
    expect(registry.listExternal()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// partitionToolCalls
// ---------------------------------------------------------------------------

describe("partitionToolCalls", () => {
  it("splits into parallel and serial groups", () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(makeTool({ name: "read", concurrencySafe: true }));
    registry.registerBuiltin(makeTool({ name: "write", concurrencySafe: false }));

    const calls = [makeCall("read", { v: "a" }), makeCall("write", { v: "b" })];
    const { parallel, serial } = partitionToolCalls(calls, registry);

    expect(parallel.length).toBe(1);
    expect(parallel[0].name).toBe("read");
    expect(serial.length).toBe(1);
    expect(serial[0].name).toBe("write");
  });

  it("puts unknown tools in serial group", () => {
    const registry = new ToolRegistry();
    const calls = [makeCall("unknown_tool", {})];
    const { parallel, serial } = partitionToolCalls(calls, registry);

    expect(parallel.length).toBe(0);
    expect(serial.length).toBe(1);
  });

  it("handles multiple concurrency-safe tools as parallel", () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(makeTool({ name: "read", concurrencySafe: true }));
    registry.registerBuiltin(makeTool({ name: "glob", concurrencySafe: true }));

    const calls = [makeCall("read", { v: "a" }), makeCall("glob", { v: "b" })];
    const { parallel, serial } = partitionToolCalls(calls, registry);

    expect(parallel.length).toBe(2);
    expect(serial.length).toBe(0);
  });

  it("handles empty calls array", () => {
    const registry = new ToolRegistry();
    const { parallel, serial } = partitionToolCalls([], registry);
    expect(parallel).toEqual([]);
    expect(serial).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scheduleToolCalls — full execution pipeline
// ---------------------------------------------------------------------------

describe("scheduleToolCalls", () => {
  it("executes tools and returns results", async () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(makeTool({ name: "echo" }));

    const { results } = await scheduleToolCalls(
      [makeCall("echo", { value: "hello" })],
      registry,
      CTX,
    );

    expect(results).toHaveLength(1);
    expect(results[0].toolName).toBe("echo");
    expect(results[0].output.output).toContain("hello");
    expect(results[0].output.isError).toBeFalsy();
  });

  it("returns standard error for unknown tools (not throwing)", async () => {
    const registry = new ToolRegistry();
    const { results } = await scheduleToolCalls(
      [makeCall("nonexistent", {})],
      registry,
      CTX,
    );

    expect(results).toHaveLength(1);
    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Unknown tool");
  });

  it("returns error for invalid JSON arguments", async () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(makeTool({ name: "echo" }));

    const { results } = await scheduleToolCalls(
      [{ id: "bad", name: "echo", arguments: "not json{" }],
      registry,
      CTX,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Invalid JSON");
  });

  it("returns error for non-object arguments", async () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(makeTool({ name: "echo" }));

    const { results } = await scheduleToolCalls(
      [{ id: "arr", name: "echo", arguments: "[1,2,3]" }],
      registry,
      CTX,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("JSON object");
  });

  it("runs semantic validation and rejects invalid input", async () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(
      makeTool({
        name: "validated",
        validate: (input) =>
          input.path === "/etc/passwd" ? "Forbidden path" : undefined,
      }),
    );

    const { results } = await scheduleToolCalls(
      [makeCall("validated", { value: "ok", path: "/etc/passwd" })],
      registry,
      CTX,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toBe("Forbidden path");
  });

  it("denies execution when external permission checker returns deny", async () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(makeTool({ name: "dangerous" }));

    const { results } = await scheduleToolCalls(
      [makeCall("dangerous", { value: "x" })],
      registry,
      CTX,
      () => "deny",
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Permission denied");
  });

  it("blocks execution when external permission checker returns ask", async () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(makeTool({ name: "ask_tool" }));

    const { results } = await scheduleToolCalls(
      [makeCall("ask_tool", { value: "x" })],
      registry,
      CTX,
      () => "ask",
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("confirmation");
  });

  it("catches tool execution errors and returns standard error", async () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(
      makeTool({
        name: "crasher",
        execute: async () => {
          throw new Error("Something went wrong");
        },
      }),
    );

    const { results } = await scheduleToolCalls(
      [makeCall("crasher", { value: "x" })],
      registry,
      CTX,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Something went wrong");
  });

  it("executes parallel tools concurrently", async () => {
    const registry = new ToolRegistry();
    const executionOrder: string[] = [];

    registry.registerBuiltin(
      makeTool({
        name: "fast_a",
        concurrencySafe: true,
        execute: async () => {
          executionOrder.push("a_start");
          await new Promise((r) => setTimeout(r, 10));
          executionOrder.push("a_end");
          return { output: "a" };
        },
      }),
    );
    registry.registerBuiltin(
      makeTool({
        name: "fast_b",
        concurrencySafe: true,
        execute: async () => {
          executionOrder.push("b_start");
          await new Promise((r) => setTimeout(r, 10));
          executionOrder.push("b_end");
          return { output: "b" };
        },
      }),
    );

    const { results } = await scheduleToolCalls(
      [makeCall("fast_a", { value: "a" }), makeCall("fast_b", { value: "b" })],
      registry,
      CTX,
    );

    expect(results).toHaveLength(2);
    expect(executionOrder.indexOf("a_start")).toBeLessThan(executionOrder.indexOf("b_end"));
    expect(executionOrder.indexOf("b_start")).toBeLessThan(executionOrder.indexOf("a_end"));
  });

  it("returns empty results for empty calls", async () => {
    const registry = new ToolRegistry();
    const { results, contextModifiers } = await scheduleToolCalls([], registry, CTX);
    expect(results).toEqual([]);
    expect(contextModifiers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// JSON Schema validation (Blocking Issue 1)
// ---------------------------------------------------------------------------

describe("JSON Schema validation", () => {
  it("rejects input missing required fields", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    registry.registerBuiltin(
      makeTool({ name: "strict", execute: executeSpy as never }),
    );

    // Schema requires "value" but we pass empty object
    const { results } = await scheduleToolCalls(
      [{ id: "c1", name: "strict", arguments: "{}" }],
      registry,
      CTX,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("required");
    expect(results[0].output.output).toContain("value");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("rejects input with wrong field type", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    registry.registerBuiltin(
      makeTool({ name: "typed", execute: executeSpy as never }),
    );

    // Schema says value: { type: "string" } but we pass number
    const { results } = await scheduleToolCalls(
      [{ id: "c2", name: "typed", arguments: '{"value": 42}' }],
      registry,
      CTX,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("type");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("rejects unknown fields when additionalProperties=false", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    const tool = buildTool({
      name: "strict_schema",
      description: "strict",
      schema: {
        input: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
          additionalProperties: false,
        },
      },
      execute: executeSpy,
    });
    registry.registerBuiltin(tool);

    const { results } = await scheduleToolCalls(
      [{ id: "c3", name: "strict_schema", arguments: '{"name":"ok","extra":true}' }],
      registry,
      CTX,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Unknown field");
    expect(results[0].output.output).toContain("extra");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("allows valid input that satisfies schema", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "done" });
    registry.registerBuiltin(
      makeTool({ name: "valid", execute: executeSpy as never }),
    );

    const { results } = await scheduleToolCalls(
      [makeCall("valid", { value: "hello" })],
      registry,
      CTX,
    );

    expect(results[0].output.isError).toBeFalsy();
    expect(executeSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tool-level checkPermissions (Blocking Issue 2)
// ---------------------------------------------------------------------------

describe("Tool-level checkPermissions", () => {
  it("tool.checkPermissions deny blocks execution", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    registry.registerBuiltin(
      makeTool({
        name: "self_deny",
        execute: executeSpy as never,
        checkPermissions: () => "deny",
      }),
    );

    const { results } = await scheduleToolCalls(
      [makeCall("self_deny", { value: "x" })],
      registry,
      CTX,
      // External checker allows — but tool deny should win
      () => "allow",
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Tool denied");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("tool.checkPermissions ask blocks execution (no UI)", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    registry.registerBuiltin(
      makeTool({
        name: "self_ask",
        execute: executeSpy as never,
        checkPermissions: () => "ask",
      }),
    );

    const { results } = await scheduleToolCalls(
      [makeCall("self_ask", { value: "x" })],
      registry,
      CTX,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("confirmation");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("tool deny overrides external allow", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    registry.registerBuiltin(
      makeTool({
        name: "override_test",
        execute: executeSpy as never,
        checkPermissions: () => "deny",
      }),
    );

    const { results } = await scheduleToolCalls(
      [makeCall("override_test", { value: "x" })],
      registry,
      CTX,
      () => "allow", // External says allow
    );

    // Tool deny must win
    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Tool denied");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("tool allow proceeds to external permission checker", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "done" });
    registry.registerBuiltin(
      makeTool({
        name: "tool_allows",
        execute: executeSpy as never,
        checkPermissions: () => "allow",
      }),
    );

    const { results } = await scheduleToolCalls(
      [makeCall("tool_allows", { value: "x" })],
      registry,
      CTX,
      () => "allow",
    );

    expect(results[0].output.isError).toBeFalsy();
    expect(executeSpy).toHaveBeenCalledOnce();
  });

  it("tool allow then external deny still blocks", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    registry.registerBuiltin(
      makeTool({
        name: "tool_ok_ext_deny",
        execute: executeSpy as never,
        checkPermissions: () => "allow",
      }),
    );

    const { results } = await scheduleToolCalls(
      [makeCall("tool_ok_ext_deny", { value: "x" })],
      registry,
      CTX,
      () => "deny",
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Permission denied");
    expect(executeSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Context modifier collection (Blocking Issue 4)
// ---------------------------------------------------------------------------

describe("Context modifier collection", () => {
  it("collects contextModifier from tool output", async () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(
      makeTool({
        name: "modifier_tool",
        execute: async () => ({
          output: "done",
          contextModifier: { filesWritten: ["/tmp/a.txt"] },
        }),
      }),
    );

    const { results, contextModifiers } = await scheduleToolCalls(
      [makeCall("modifier_tool", { value: "x" })],
      registry,
      CTX,
    );

    expect(results[0].output.output).toBe("done");
    expect(contextModifiers).toHaveLength(1);
    expect(contextModifiers[0]).toEqual({ filesWritten: ["/tmp/a.txt"] });
  });

  it("collects modifiers from parallel batch after all complete", async () => {
    const registry = new ToolRegistry();

    registry.registerBuiltin(
      makeTool({
        name: "par_a",
        concurrencySafe: true,
        execute: async () => ({
          output: "a",
          contextModifier: { tool: "a", order: 1 },
        }),
      }),
    );
    registry.registerBuiltin(
      makeTool({
        name: "par_b",
        concurrencySafe: true,
        execute: async () => ({
          output: "b",
          contextModifier: { tool: "b", order: 2 },
        }),
      }),
    );

    const { contextModifiers } = await scheduleToolCalls(
      [makeCall("par_a", { value: "a" }), makeCall("par_b", { value: "b" })],
      registry,
      CTX,
    );

    // Both modifiers collected
    expect(contextModifiers).toHaveLength(2);
    const tools = contextModifiers.map((m) => m.tool).sort();
    expect(tools).toEqual(["a", "b"]);
  });

  it("returns empty contextModifiers when no tools produce them", async () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(makeTool({ name: "plain" }));

    const { contextModifiers } = await scheduleToolCalls(
      [makeCall("plain", { value: "x" })],
      registry,
      CTX,
    );

    expect(contextModifiers).toEqual([]);
  });

  it("error results do not contribute contextModifiers", async () => {
    const registry = new ToolRegistry();
    // Unknown tool → error result, no contextModifier
    const { results, contextModifiers } = await scheduleToolCalls(
      [makeCall("nonexistent", {})],
      registry,
      CTX,
    );

    expect(results[0].output.isError).toBe(true);
    expect(contextModifiers).toEqual([]);
  });

  it("tool returning isError:true with contextModifier does not contribute modifier", async () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(
      makeTool({
        name: "failing_modifier",
        execute: async () => ({
          output: "failed",
          isError: true,
          contextModifier: { shouldNot: "appear" },
        }),
      }),
    );

    const { results, contextModifiers } = await scheduleToolCalls(
      [makeCall("failing_modifier", { value: "x" })],
      registry,
      CTX,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.contextModifier).toEqual({ shouldNot: "appear" });
    expect(contextModifiers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Exception safety: validate / checkPermissions / permissionChecker (Issue 1)
// ---------------------------------------------------------------------------

describe("Exception safety in pipeline", () => {
  it("tool.validate throwing returns standard error result without executing", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    registry.registerBuiltin(
      makeTool({
        name: "validate_crasher",
        execute: executeSpy as never,
        validate: () => {
          throw new Error("validate exploded");
        },
      }),
    );

    const { results } = await scheduleToolCalls(
      [makeCall("validate_crasher", { value: "x" })],
      registry,
      CTX,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("validate exploded");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("tool.checkPermissions throwing returns standard error result without executing", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    registry.registerBuiltin(
      makeTool({
        name: "perm_crasher",
        execute: executeSpy as never,
        checkPermissions: () => {
          throw new Error("permission check blew up");
        },
      }),
    );

    const { results } = await scheduleToolCalls(
      [makeCall("perm_crasher", { value: "x" })],
      registry,
      CTX,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("permission check blew up");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("external permissionChecker throwing returns standard error result without executing", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    registry.registerBuiltin(
      makeTool({
        name: "ext_perm_crasher",
        execute: executeSpy as never,
      }),
    );

    const { results } = await scheduleToolCalls(
      [makeCall("ext_perm_crasher", { value: "x" })],
      registry,
      CTX,
      () => {
        throw new Error("external checker crashed");
      },
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("external checker crashed");
    expect(executeSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PreToolUse Hooks placeholder (Issue 3)
// ---------------------------------------------------------------------------

describe("PreToolUse Hooks", () => {
  it("hook deny blocks tool execution", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    registry.registerBuiltin(
      makeTool({ name: "hooked", execute: executeSpy as never }),
    );

    const denyHook: PreToolUseHook = {
      name: "block_all",
      run: async () => "deny",
    };

    const { results } = await scheduleToolCalls(
      [makeCall("hooked", { value: "x" })],
      registry,
      CTX,
      { preToolUseHooks: [denyHook] },
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("block_all");
    expect(results[0].output.output).toContain("denied");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("hook allow proceeds to permission checks and execution", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "done" });
    registry.registerBuiltin(
      makeTool({ name: "hooked_ok", execute: executeSpy as never }),
    );

    const allowHook: PreToolUseHook = {
      name: "pass_through",
      run: async () => "allow",
    };

    const { results } = await scheduleToolCalls(
      [makeCall("hooked_ok", { value: "x" })],
      registry,
      CTX,
      { preToolUseHooks: [allowHook] },
    );

    expect(results[0].output.isError).toBeFalsy();
    expect(results[0].output.output).toBe("done");
    expect(executeSpy).toHaveBeenCalledOnce();
  });

  it("hook throwing returns standard error result without executing", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    registry.registerBuiltin(
      makeTool({ name: "hook_crash", execute: executeSpy as never }),
    );

    const crashHook: PreToolUseHook = {
      name: "crasher",
      run: async () => {
        throw new Error("hook imploded");
      },
    };

    const { results } = await scheduleToolCalls(
      [makeCall("hook_crash", { value: "x" })],
      registry,
      CTX,
      { preToolUseHooks: [crashHook] },
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("crasher");
    expect(results[0].output.output).toContain("hook imploded");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("multiple hooks run in order, first deny stops pipeline", async () => {
    const registry = new ToolRegistry();
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    registry.registerBuiltin(
      makeTool({ name: "multi_hook", execute: executeSpy as never }),
    );

    const order: string[] = [];
    const hook1: PreToolUseHook = {
      name: "first",
      run: async () => { order.push("first"); return "allow"; },
    };
    const hook2: PreToolUseHook = {
      name: "second",
      run: async () => { order.push("second"); return "deny"; },
    };
    const hook3: PreToolUseHook = {
      name: "third",
      run: async () => { order.push("third"); return "allow"; },
    };

    const { results } = await scheduleToolCalls(
      [makeCall("multi_hook", { value: "x" })],
      registry,
      CTX,
      { preToolUseHooks: [hook1, hook2, hook3] },
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("second");
    expect(order).toEqual(["first", "second"]); // third never ran
    expect(executeSpy).not.toHaveBeenCalled();
  });
});
