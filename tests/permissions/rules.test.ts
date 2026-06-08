// Tests for permission modes, rules parsing/matching, and checker

import { describe, it, expect, vi } from "vitest";
import { checkModePermission, type PermissionMode } from "../../src/permissions/modes.js";
import {
  parseRule,
  matchRule,
  evaluateRules,
  type PermissionRule,
} from "../../src/permissions/rules.js";
import {
  createPermissionChecker,
  normalizePath,
  isWithinProject,
  resolveToolPath,
} from "../../src/permissions/checker.js";
import { buildTool, type Tool } from "../../src/tools/base.js";
import type { ToolInput, ToolContext } from "../../src/tools/base.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { scheduleToolCalls, type ToolCall } from "../../src/tools/scheduler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CTX: ToolContext = { cwd: "/project" };

function makeTool(overrides: {
  name?: string;
  readOnly?: boolean;
}): Tool {
  return buildTool({
    name: overrides.name ?? "TestTool",
    description: "test",
    schema: { input: { type: "object" } },
    security: {
      readOnly: overrides.readOnly ?? false,
      concurrencySafe: false,
      destructive: true,
    },
    execute: async () => ({ output: "ok" }),
  });
}

// ---------------------------------------------------------------------------
// Permission modes
// ---------------------------------------------------------------------------

describe("checkModePermission", () => {
  it("plan mode allows read-only tools", () => {
    const tool = makeTool({ name: "FileRead", readOnly: true });
    expect(checkModePermission("plan", tool)).toBe("allow");
  });

  it("plan mode denies non-read-only tools", () => {
    const tool = makeTool({ name: "FileWrite", readOnly: false });
    expect(checkModePermission("plan", tool)).toBe("deny");
  });

  it("default mode allows read-only tools", () => {
    const tool = makeTool({ readOnly: true });
    expect(checkModePermission("default", tool)).toBe("allow");
  });

  it("default mode asks for non-read-only tools", () => {
    const tool = makeTool({ readOnly: false });
    expect(checkModePermission("default", tool)).toBe("ask");
  });

  it("acceptEdits mode allows FileWrite", () => {
    const tool = makeTool({ name: "FileWrite", readOnly: false });
    expect(checkModePermission("acceptEdits", tool)).toBe("allow");
  });

  it("acceptEdits mode allows FileEdit", () => {
    const tool = makeTool({ name: "FileEdit", readOnly: false });
    expect(checkModePermission("acceptEdits", tool)).toBe("allow");
  });

  it("acceptEdits mode asks for non-file non-readonly tools", () => {
    const tool = makeTool({ name: "Bash", readOnly: false });
    expect(checkModePermission("acceptEdits", tool)).toBe("ask");
  });

  it("auto mode always asks", () => {
    const tool = makeTool({ readOnly: true });
    expect(checkModePermission("auto", tool)).toBe("ask");
  });

  it("bypassPermissions mode always allows", () => {
    const tool = makeTool({ readOnly: false });
    expect(checkModePermission("bypassPermissions", tool)).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// Rule parsing
// ---------------------------------------------------------------------------

describe("parseRule", () => {
  it("parses wildcard rule", () => {
    const rule = parseRule("*", "deny");
    expect(rule).toEqual({ effect: "deny", toolPattern: "*", argPattern: "*" });
  });

  it("parses bare tool name", () => {
    const rule = parseRule("Bash", "allow");
    expect(rule).toEqual({ effect: "allow", toolPattern: "Bash", argPattern: "*" });
  });

  it("parses ToolName(pattern)", () => {
    const rule = parseRule("FileWrite(/secret:*)", "deny");
    expect(rule).toEqual({
      effect: "deny",
      toolPattern: "FileWrite",
      argPattern: "/secret:*",
    });
  });

  it("parses Bash(rm:*) pattern", () => {
    const rule = parseRule("Bash(rm:*)", "deny");
    expect(rule.toolPattern).toBe("Bash");
    expect(rule.argPattern).toBe("rm:*");
  });
});

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

describe("matchRule", () => {
  it("wildcard matches any tool", () => {
    const rule = parseRule("*", "deny");
    expect(matchRule(rule, "Anything", {})).toBe(true);
  });

  it("exact tool name matches", () => {
    const rule = parseRule("Bash", "allow");
    expect(matchRule(rule, "Bash", {})).toBe(true);
    expect(matchRule(rule, "FileRead", {})).toBe(false);
  });

  it("arg pattern matches tool arguments", () => {
    const rule = parseRule("FileWrite(/secret:*)", "deny");
    expect(matchRule(rule, "FileWrite", { path: "/secret/keys" })).toBe(true);
    expect(matchRule(rule, "FileWrite", { path: "/public/readme" })).toBe(false);
  });

  it("prefix:* arg pattern matches", () => {
    const rule = parseRule("Bash(rm:*)", "deny");
    expect(matchRule(rule, "Bash", { command: "rm -rf /" })).toBe(true);
    expect(matchRule(rule, "Bash", { command: "ls -la" })).toBe(false);
  });

  it("arg pattern * matches any args", () => {
    const rule = parseRule("FileWrite", "allow");
    expect(matchRule(rule, "FileWrite", { path: "/anything" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule evaluation (priority)
// ---------------------------------------------------------------------------

describe("evaluateRules", () => {
  it("deny rules take priority over allow", () => {
    const rules: PermissionRule[] = [
      parseRule("*", "allow"),
      parseRule("Bash(rm:*)", "deny"),
    ];
    // deny is checked first regardless of array order
    expect(evaluateRules(rules, "Bash", { command: "rm -rf /" })).toBe("deny");
  });

  it("returns allow when only allow rules match", () => {
    const rules = [parseRule("FileRead", "allow")];
    expect(evaluateRules(rules, "FileRead", {})).toBe("allow");
  });

  it("returns null when no rules match", () => {
    const rules = [parseRule("Bash", "allow")];
    expect(evaluateRules(rules, "FileWrite", {})).toBeNull();
  });

  it("ask rules have priority between deny and allow", () => {
    const rules: PermissionRule[] = [
      parseRule("FileWrite", "allow"),
      parseRule("FileWrite(/secret:*)", "ask"),
    ];
    // ask is checked before allow
    expect(evaluateRules(rules, "FileWrite", { path: "/secret/key" })).toBe("ask");
  });

  it("deny overrides ask", () => {
    const rules: PermissionRule[] = [
      parseRule("*", "ask"),
      parseRule("Bash(rm:*)", "deny"),
    ];
    expect(evaluateRules(rules, "Bash", { command: "rm -rf /" })).toBe("deny");
  });
});

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

describe("normalizePath", () => {
  it("resolves .. segments", () => {
    expect(normalizePath("/a/b/../c")).toBe("/a/c");
  });

  it("removes double slashes", () => {
    expect(normalizePath("//a//b")).toBe("/a/b");
  });
});

describe("isWithinProject", () => {
  it("accepts paths within project root", () => {
    expect(isWithinProject("/project/src/file.ts", "/project")).toBe(true);
  });

  it("accepts the project root itself", () => {
    expect(isWithinProject("/project", "/project")).toBe(true);
  });

  it("rejects paths outside project root", () => {
    expect(isWithinProject("/etc/passwd", "/project")).toBe(false);
  });

  it("rejects path traversal attempts", () => {
    // node:path resolves /project/../etc/passwd → /etc/passwd
    expect(isWithinProject("/project/../etc/passwd", "/project")).toBe(false);
  });

  it("rejects ../../etc/passwd resolved from project", () => {
    // resolveToolPath resolves relative to cwd
    const resolved = resolveToolPath("../../etc/passwd", "/project/src");
    expect(isWithinProject(resolved, "/project")).toBe(false);
  });
});

describe("resolveToolPath", () => {
  it("resolves relative path against cwd", () => {
    expect(resolveToolPath("src/a.txt", "/project")).toBe("/project/src/a.txt");
  });

  it("keeps absolute path unchanged", () => {
    expect(resolveToolPath("/absolute/path", "/project")).toBe("/absolute/path");
  });
});

// ---------------------------------------------------------------------------
// Permission checker integration
// ---------------------------------------------------------------------------

describe("createPermissionChecker", () => {
  it("deny rules block execution regardless of mode", () => {
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [parseRule("FileWrite(/secret:*)", "deny")],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "FileWrite" });
    expect(checker(tool, { path: "/secret/keys" }, CTX)).toBe("deny");
  });

  it("plan mode denies non-readonly via checker", () => {
    const checker = createPermissionChecker({
      mode: "plan",
      rules: [],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "FileWrite", readOnly: false });
    expect(checker(tool, { path: "/project/x" }, CTX)).toBe("deny");
  });

  it("plan mode allows readonly via checker", () => {
    const checker = createPermissionChecker({
      mode: "plan",
      rules: [],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "FileRead", readOnly: true });
    expect(checker(tool, { path: "/project/x" }, CTX)).toBe("allow");
  });

  it("allow rules override mode ask", () => {
    const checker = createPermissionChecker({
      mode: "default",
      rules: [parseRule("Bash", "allow")],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "Bash", readOnly: false });
    expect(checker(tool, { command: "ls" }, CTX)).toBe("allow");
  });

  it("ask rules trigger confirmation", () => {
    const checker = createPermissionChecker({
      mode: "default",
      rules: [parseRule("FileWrite", "ask")],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "FileWrite", readOnly: false });
    expect(checker(tool, { path: "/project/x" }, CTX)).toBe("ask");
  });

  it("default behavior returns ask when no rules match and non-readonly", () => {
    const checker = createPermissionChecker({
      mode: "default",
      rules: [],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "Bash", readOnly: false });
    expect(checker(tool, {}, CTX)).toBe("ask");
  });
});

// ---------------------------------------------------------------------------
// Project boundary enforcement
// ---------------------------------------------------------------------------

describe("Project boundary enforcement", () => {
  it("denies FileWrite with absolute path outside project", () => {
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "FileWrite" });
    expect(checker(tool, { path: "/outside/file.txt" }, CTX)).toBe("deny");
  });

  it("denies FileEdit with absolute path outside project", () => {
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "FileEdit" });
    expect(checker(tool, { path: "/etc/hosts", old_string: "x", new_string: "y" }, CTX)).toBe("deny");
  });

  it("denies FileWrite with relative path escaping project", () => {
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "FileWrite" });
    // checker resolves input.path against projectRoot
    expect(checker(tool, { path: "../outside/file.txt" }, CTX)).toBe("deny");
  });

  it("denies FileEdit with relative path escaping project", () => {
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "FileEdit" });
    expect(checker(tool, { path: "../../etc/passwd", old_string: "x", new_string: "y" }, CTX)).toBe("deny");
  });

  it("allows FileWrite with relative path within project", () => {
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "FileWrite" });
    // src/a.txt resolved against projectRoot → /project/src/a.txt, within project
    expect(checker(tool, { path: "src/a.txt" }, CTX)).toBe("allow");
  });

  it("allows FileRead with path within project", () => {
    const checker = createPermissionChecker({
      mode: "plan",
      rules: [],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "FileRead", readOnly: true });
    expect(checker(tool, { path: "/project/src/a.txt" }, CTX)).toBe("allow");
  });

  it("denies FileRead with path outside project", () => {
    const checker = createPermissionChecker({
      mode: "plan",
      rules: [],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "FileRead", readOnly: true });
    expect(checker(tool, { path: "/etc/passwd" }, CTX)).toBe("deny");
  });

  it("non-path tools bypass project boundary check", () => {
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/project",
    });
    const tool = makeTool({ name: "Bash" });
    // Bash has no `path` field, so boundary check is skipped
    expect(checker(tool, { command: "ls" }, CTX)).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// context.cwd vs projectRoot mismatch scenarios
// ---------------------------------------------------------------------------

describe("context.cwd vs projectRoot mismatch", () => {
  it("denies FileWrite when context.cwd is outside project and path is relative", () => {
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/repo",
    });
    const tool = makeTool({ name: "FileWrite" });
    // context.cwd=/tmp, path=safe.txt → resolves to /tmp/safe.txt → outside /repo
    const outsideCtx: ToolContext = { cwd: "/tmp" };
    expect(checker(tool, { path: "safe.txt" }, outsideCtx)).toBe("deny");
  });

  it("allows FileWrite when context.cwd is within project and relative path stays inside", () => {
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/repo",
    });
    const tool = makeTool({ name: "FileWrite" });
    // context.cwd=/repo/sub, path=../ok.txt → resolves to /repo/ok.txt → inside /repo
    const insideCtx: ToolContext = { cwd: "/repo/sub" };
    expect(checker(tool, { path: "../ok.txt" }, insideCtx)).toBe("allow");
  });

  it("denies FileWrite when context.cwd is within project but relative path escapes", () => {
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/repo",
    });
    const tool = makeTool({ name: "FileWrite" });
    // context.cwd=/repo/sub, path=../../out.txt → resolves to /out.txt → outside /repo
    const insideCtx: ToolContext = { cwd: "/repo/sub" };
    expect(checker(tool, { path: "../../out.txt" }, insideCtx)).toBe("deny");
  });

  it("denies Glob without input.path when context.cwd is outside project", () => {
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/repo",
    });
    const tool = makeTool({ name: "Glob" });
    const outsideCtx: ToolContext = { cwd: "/tmp" };
    // Glob defaults to context.cwd which is /tmp → outside /repo
    expect(checker(tool, { pattern: "**/*.ts" }, outsideCtx)).toBe("deny");
  });

  it("denies Grep without input.path when context.cwd is outside project", () => {
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/repo",
    });
    const tool = makeTool({ name: "Grep" });
    const outsideCtx: ToolContext = { cwd: "/tmp" };
    expect(checker(tool, { pattern: "TODO" }, outsideCtx)).toBe("deny");
  });

  it("allows Glob when context.cwd is within project", () => {
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/repo",
    });
    const tool = makeTool({ name: "Glob" });
    const insideCtx: ToolContext = { cwd: "/repo/src" };
    expect(checker(tool, { pattern: "**/*.ts" }, insideCtx)).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// ScheduleToolCalls + createPermissionChecker integration
// ---------------------------------------------------------------------------

describe("scheduleToolCalls + permission boundary integration", () => {
  it("boundary deny prevents tool.execute from running", async () => {
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    const registry = new ToolRegistry();
    registry.registerBuiltin(buildTool({
      name: "FileWrite",
      description: "test write",
      schema: {
        input: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
      security: { readOnly: false, concurrencySafe: false, destructive: true },
      execute: executeSpy,
    }));

    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/repo",
    });

    // context.cwd=/tmp, path=safe.txt → resolves to /tmp/safe.txt → outside /repo
    const outsideCtx: ToolContext = { cwd: "/tmp" };
    const call: ToolCall = {
      id: "boundary_test",
      name: "FileWrite",
      arguments: JSON.stringify({ path: "safe.txt", content: "data" }),
    };

    const { results } = await scheduleToolCalls(
      [call],
      registry,
      outsideCtx,
      checker,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Permission denied");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("boundary allow proceeds to tool.execute", async () => {
    const executeSpy = vi.fn().mockResolvedValue({ output: "done" });
    const registry = new ToolRegistry();
    registry.registerBuiltin(buildTool({
      name: "FileWrite",
      description: "test write",
      schema: {
        input: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
      security: { readOnly: false, concurrencySafe: false, destructive: true },
      execute: executeSpy,
    }));

    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [],
      projectRoot: "/repo",
    });

    // context.cwd=/repo, path=src/a.txt → resolves to /repo/src/a.txt → inside /repo
    const insideCtx: ToolContext = { cwd: "/repo" };
    const call: ToolCall = {
      id: "boundary_allow",
      name: "FileWrite",
      arguments: JSON.stringify({ path: "src/a.txt", content: "data" }),
    };

    const { results } = await scheduleToolCalls(
      [call],
      registry,
      insideCtx,
      checker,
    );

    expect(results[0].output.isError).toBeFalsy();
    expect(executeSpy).toHaveBeenCalledOnce();
  });

  it("deny rule matches resolved path", async () => {
    const executeSpy = vi.fn().mockResolvedValue({ output: "should not run" });
    const registry = new ToolRegistry();
    registry.registerBuiltin(buildTool({
      name: "FileWrite",
      description: "test write",
      schema: {
        input: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
      security: { readOnly: false, concurrencySafe: false, destructive: true },
      execute: executeSpy,
    }));

    // Deny rule uses resolved absolute path
    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [parseRule("FileWrite(/repo/secret:*)", "deny")],
      projectRoot: "/repo",
    });

    // context.cwd=/repo, path=secret/key.txt → resolves to /repo/secret/key.txt
    const insideCtx: ToolContext = { cwd: "/repo" };
    const call: ToolCall = {
      id: "rule_test",
      name: "FileWrite",
      arguments: JSON.stringify({ path: "secret/key.txt", content: "data" }),
    };

    const { results } = await scheduleToolCalls(
      [call],
      registry,
      insideCtx,
      checker,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Permission denied");
    expect(executeSpy).not.toHaveBeenCalled();
  });
});
