// Tools e2e tests — scheduler/permission chain, file workflow, glob, grep, bash
//
// Tests:
// 1. scheduleToolCalls with deny rule blocks execution (execute spy not called)
// 2. scheduleToolCalls with ask rule blocks in non-interactive mode
// 3. scheduleToolCalls with allow rule permits safe command
// 4. FileWrite -> FileRead -> FileEdit -> FileRead cycle
// 5. Glob and Grep tools
// 6. Bash tool execution
// 7. Permission checker in plan mode
// 8. createBuiltinRegistry registers all tools

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileReadTool } from "../../src/tools/builtin/file-read.js";
import { fileWriteTool } from "../../src/tools/builtin/file-write.js";
import { fileEditTool } from "../../src/tools/builtin/file-edit.js";
import { globTool } from "../../src/tools/builtin/glob.js";
import { grepTool } from "../../src/tools/builtin/grep.js";
import { bashTool } from "../../src/tools/builtin/bash.js";
import { createBuiltinRegistry } from "../../src/tools/builtin/registry-factory.js";
import { createPermissionChecker } from "../../src/permissions/checker.js";
import { scheduleToolCalls, type ToolCall } from "../../src/tools/scheduler.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { ToolContext, Tool, ToolInput, ToolOutput } from "../../src/tools/base.js";
import type { PermissionChecker } from "../../src/tools/scheduler.js";
import { parseRule } from "../../src/permissions/rules.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-e2e-tools-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function ctx(): ToolContext {
  return { cwd: testDir };
}

// ---------------------------------------------------------------------------
// Tests — scheduleToolCalls with permission rules
// ---------------------------------------------------------------------------

describe("scheduleToolCalls — deny rule blocks execution", () => {
  it("Bash deny rule for rm:* blocks execution and execute is not called", async () => {
    const registry = createBuiltinRegistry();

    // Spy on the Bash tool's execute method
    const bashToolFromRegistry = registry.get("Bash");
    expect(bashToolFromRegistry).toBeDefined();
    const executeSpy = vi.spyOn(bashToolFromRegistry!, "execute");

    // Create permission checker with deny rule for rm:*
    const denyRule = parseRule("Bash(rm:*)", "deny");
    const checker: PermissionChecker = createPermissionChecker({
      mode: "default",
      rules: [denyRule],
      projectRoot: testDir,
    });

    const calls: ToolCall[] = [
      {
        id: "tc-rm",
        name: "Bash",
        arguments: JSON.stringify({ command: "rm -rf /tmp/test" }),
      },
    ];

    const { results } = await scheduleToolCalls(calls, registry, ctx(), checker);

    expect(results).toHaveLength(1);
    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Permission denied");

    // execute must NOT have been called
    expect(executeSpy).not.toHaveBeenCalled();

    executeSpy.mockRestore();
  });

  it("multiple tool calls: deny blocks only the matching one", async () => {
    const registry = createBuiltinRegistry();

    const bashToolFromRegistry = registry.get("Bash")!;
    const executeSpy = vi.spyOn(bashToolFromRegistry, "execute");

    // Allow echo, deny rm — echo should succeed, rm should be denied
    const allowRule = parseRule("Bash(echo:*)", "allow");
    const denyRule = parseRule("Bash(rm:*)", "deny");
    const checker: PermissionChecker = createPermissionChecker({
      mode: "default",
      rules: [allowRule, denyRule],
      projectRoot: testDir,
    });

    const calls: ToolCall[] = [
      {
        id: "tc-echo",
        name: "Bash",
        arguments: JSON.stringify({ command: "echo hello" }),
      },
      {
        id: "tc-rm",
        name: "Bash",
        arguments: JSON.stringify({ command: "rm -rf /tmp/test" }),
      },
    ];

    const { results } = await scheduleToolCalls(calls, registry, ctx(), checker);

    expect(results).toHaveLength(2);

    // echo should succeed
    const echoResult = results.find((r) => r.toolCallId === "tc-echo");
    expect(echoResult!.output.isError).toBeFalsy();
    expect(echoResult!.output.output.trim()).toBe("hello");

    // rm should be denied
    const rmResult = results.find((r) => r.toolCallId === "tc-rm");
    expect(rmResult!.output.isError).toBe(true);
    expect(rmResult!.output.output).toContain("Permission denied");

    // execute should be called once (for echo)
    expect(executeSpy).toHaveBeenCalledTimes(1);

    executeSpy.mockRestore();
  });
});

describe("scheduleToolCalls — ask rule blocks without UI", () => {
  it("ask rule for Bash blocks execution in non-interactive mode (no askUser callback)", async () => {
    const registry = createBuiltinRegistry();

    // Create permission checker with ask rule for all Bash
    const askRule = parseRule("Bash", "ask");
    const checker: PermissionChecker = createPermissionChecker({
      mode: "default",
      rules: [askRule],
      projectRoot: testDir,
    });

    const calls: ToolCall[] = [
      {
        id: "tc-ask",
        name: "Bash",
        arguments: JSON.stringify({ command: "echo confirm" }),
      },
    ];

    const { results } = await scheduleToolCalls(calls, registry, ctx(), checker);

    expect(results).toHaveLength(1);
    expect(results[0].output.isError).toBe(true);
    // "ask" in scheduler maps to "Tool requires confirmation" when no UI
    expect(results[0].output.output).toContain("requires confirmation");
  });
});

describe("scheduleToolCalls — allow rule permits execution", () => {
  it("explicit allow rule permits Bash command execution", async () => {
    const registry = createBuiltinRegistry();

    // Default mode has Bash as "ask" — but explicit allow overrides
    const allowRule = parseRule("Bash(echo:*)", "allow");
    const checker: PermissionChecker = createPermissionChecker({
      mode: "default",
      rules: [allowRule],
      projectRoot: testDir,
    });

    const calls: ToolCall[] = [
      {
        id: "tc-allow",
        name: "Bash",
        arguments: JSON.stringify({ command: "echo allowed" }),
      },
    ];

    const { results } = await scheduleToolCalls(calls, registry, ctx(), checker);

    expect(results).toHaveLength(1);
    expect(results[0].output.isError).toBeFalsy();
    expect(results[0].output.output.trim()).toBe("allowed");
  });

  it("wildcard allow rule permits all Bash commands", async () => {
    const registry = createBuiltinRegistry();

    const allowRule = parseRule("*", "allow");
    const checker: PermissionChecker = createPermissionChecker({
      mode: "default",
      rules: [allowRule],
      projectRoot: testDir,
    });

    const calls: ToolCall[] = [
      {
        id: "tc-wildcard",
        name: "Bash",
        arguments: JSON.stringify({ command: "echo wildcard" }),
      },
    ];

    const { results } = await scheduleToolCalls(calls, registry, ctx(), checker);

    expect(results).toHaveLength(1);
    expect(results[0].output.isError).toBeFalsy();
    expect(results[0].output.output.trim()).toBe("wildcard");
  });
});

describe("scheduleToolCalls — deny takes priority over allow", () => {
  it("deny rule overrides allow rule for same pattern", async () => {
    const registry = createBuiltinRegistry();

    const bashToolFromRegistry = registry.get("Bash")!;
    const executeSpy = vi.spyOn(bashToolFromRegistry, "execute");

    const allowRule = parseRule("Bash", "allow");
    const denyRule = parseRule("Bash(rm:*)", "deny");
    const checker: PermissionChecker = createPermissionChecker({
      mode: "default",
      rules: [allowRule, denyRule],
      projectRoot: testDir,
    });

    const calls: ToolCall[] = [
      {
        id: "tc-deny-override",
        name: "Bash",
        arguments: JSON.stringify({ command: "rm -rf /tmp" }),
      },
    ];

    const { results } = await scheduleToolCalls(calls, registry, ctx(), checker);

    expect(results).toHaveLength(1);
    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Permission denied");

    // execute must NOT have been called
    expect(executeSpy).not.toHaveBeenCalled();

    executeSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Tests — File tools workflow
// ---------------------------------------------------------------------------

describe("Tools — file workflow", () => {
  it("FileWrite -> FileRead -> FileEdit -> FileRead cycle", async () => {
    const filePath = join(testDir, "cycle.txt");

    // Write
    const writeResult = await fileWriteTool.execute(
      { path: filePath, content: "Hello World" },
      ctx(),
    );
    expect(writeResult.isError).toBeFalsy();
    expect(writeResult.output).toContain("File written");

    // Read
    const readResult = await fileReadTool.execute({ path: filePath }, ctx());
    expect(readResult.output).toBe("Hello World");

    // Edit
    const editResult = await fileEditTool.execute(
      { path: filePath, old_string: "Hello", new_string: "Goodbye" },
      ctx(),
    );
    expect(editResult.isError).toBeFalsy();

    // Read again
    const readResult2 = await fileReadTool.execute({ path: filePath }, ctx());
    expect(readResult2.output).toBe("Goodbye World");
  });
});

// ---------------------------------------------------------------------------
// Tests — Glob and Grep
// ---------------------------------------------------------------------------

describe("Tools — Glob", () => {
  it("finds files matching pattern", async () => {
    await writeFile(join(testDir, "a.ts"), "a", "utf-8");
    await writeFile(join(testDir, "b.ts"), "b", "utf-8");
    await writeFile(join(testDir, "c.js"), "c", "utf-8");

    const result = await globTool.execute(
      { pattern: "*.ts", path: testDir },
      ctx(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("a.ts");
    expect(result.output).toContain("b.ts");
    expect(result.output).not.toContain("c.js");
  });
});

describe("Tools — Grep", () => {
  it("finds content in files", async () => {
    await writeFile(join(testDir, "search.txt"), "foo bar baz", "utf-8");

    const result = await grepTool.execute(
      { pattern: "bar", path: testDir, include: "*.txt" },
      ctx(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("bar");
  });
});

// ---------------------------------------------------------------------------
// Tests — Bash
// ---------------------------------------------------------------------------

describe("Tools — Bash", () => {
  it("executes a command", async () => {
    const result = await bashTool.execute(
      { command: "echo hello" },
      ctx(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.output.trim()).toBe("hello");
  });

  it("reports command failure", async () => {
    const result = await bashTool.execute(
      { command: "false" },
      ctx(),
    );
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — Permission checker in plan mode
// ---------------------------------------------------------------------------

describe("Tools — permission deny in plan mode", () => {
  it("FileWrite is denied in plan mode", () => {
    const checker: PermissionChecker = createPermissionChecker({
      mode: "plan",
      rules: [],
      projectRoot: testDir,
    });

    const filePath = join(testDir, "denied.txt");
    const result = checker(fileWriteTool, { path: filePath, content: "test" }, ctx());
    expect(result).toBe("deny");
  });

  it("FileRead is allowed in plan mode", () => {
    const checker: PermissionChecker = createPermissionChecker({
      mode: "plan",
      rules: [],
      projectRoot: testDir,
    });

    const result = checker(fileReadTool, { path: join(testDir, "any.txt") }, ctx());
    expect(result).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// Tests — createBuiltinRegistry
// ---------------------------------------------------------------------------

describe("Tools — createBuiltinRegistry", () => {
  it("registers all 21 builtin tools", () => {
    const registry = createBuiltinRegistry();
    const tools = registry.listBuiltins();
    const names = tools.map((t) => t.name).sort();

    const expected = [
      "Agent",
      "AskUser",
      "Bash",
      "EnterPlanMode",
      "EnterWorktree",
      "ExitPlanMode",
      "ExitWorktree",
      "FileEdit",
      "FileRead",
      "FileWrite",
      "Glob",
      "Grep",
      "NotebookEdit",
      "ScheduleCron",
      "Skill",
      "TaskCreate",
      "TaskGet",
      "TaskList",
      "TaskUpdate",
      "WebFetch",
      "WebSearch",
    ].sort();

    expect(names).toEqual(expected);
    expect(tools).toHaveLength(21);
  });
});
