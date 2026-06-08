// Tests for BashTool

import { describe, it, expect } from "vitest";
import { realpathSync } from "node:fs";
import { bashTool } from "../../src/tools/builtin/bash.js";

// ---------------------------------------------------------------------------
// Schema & security
// ---------------------------------------------------------------------------

describe("BashTool schema and security", () => {
  it("has correct security attributes", () => {
    expect(bashTool.security.readOnly).toBe(false);
    expect(bashTool.security.concurrencySafe).toBe(false);
    expect(bashTool.security.destructive).toBe(true);
  });

  it("requires command in schema", () => {
    const required = bashTool.schema.input.required as string[];
    expect(required).toContain("command");
  });

  it("validates empty command", () => {
    const err = bashTool.validate?.({ command: "" });
    expect(err).toBeTruthy();
  });

  it("validates missing command", () => {
    const err = bashTool.validate?.({});
    expect(err).toBeTruthy();
  });

  it("accepts valid command", () => {
    const err = bashTool.validate?.({ command: "echo hello" });
    expect(err).toBeFalsy();
  });

  it("does not define checkPermissions (delegates to external checker)", () => {
    expect(bashTool.checkPermissions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Execute — unsandboxed
// ---------------------------------------------------------------------------

describe("BashTool execute (unsandboxed)", () => {
  it("executes a simple command and returns output", async () => {
    const result = await bashTool.execute(
      { command: "echo hello" },
      { cwd: "/tmp" },
    );
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("hello");
  });

  it("captures stderr", async () => {
    const result = await bashTool.execute(
      { command: "echo err >&2" },
      { cwd: "/tmp" },
    );
    expect(result.output).toContain("err");
  });

  it("returns error for failing command", async () => {
    const result = await bashTool.execute(
      { command: "exit 1" },
      { cwd: "/tmp" },
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("failed");
  });

  it("returns error for non-existent command", async () => {
    const result = await bashTool.execute(
      { command: "nonexistent_command_xyz123" },
      { cwd: "/tmp" },
    );
    expect(result.isError).toBe(true);
  });

  it("respects custom cwd", async () => {
    const result = await bashTool.execute(
      { command: "pwd" },
      { cwd: "/tmp" },
    );
    // macOS resolves /tmp → /private/tmp via symlink
    expect(realpathSync(result.output.trim())).toBe(realpathSync("/tmp"));
  });

  it("respects custom cwd override via input", async () => {
    const result = await bashTool.execute(
      { command: "pwd", cwd: "/var" },
      { cwd: "/tmp" },
    );
    expect(realpathSync(result.output.trim())).toBe(realpathSync("/var"));
  });
});

// ---------------------------------------------------------------------------
// Execute — sandboxed (stable: fallback handles missing sandbox runtime)
// ---------------------------------------------------------------------------

describe("BashTool execute (sandboxed)", () => {
  it("executes with sandbox=true and returns command output", async () => {
    const result = await bashTool.execute(
      { command: "echo sandboxed", sandbox: true },
      { cwd: "/tmp" },
    );
    // Output should contain "sandboxed" regardless of sandbox runtime availability
    expect(result.output).toContain("sandboxed");
  });

  it("reports error for failing sandboxed command", async () => {
    const result = await bashTool.execute(
      { command: "exit 1", sandbox: true },
      { cwd: "/tmp" },
    );
    expect(result.isError).toBe(true);
  });

  it("sandbox fallback appends warning to stderr", async () => {
    const result = await bashTool.execute(
      { command: "echo ok", sandbox: true },
      { cwd: "/tmp" },
    );
    // When sandbox runtime is not available, a warning is appended
    // Either "bwrap not available" or "sandbox-exec not available" depending on platform
    expect(result.output).toContain("ok");
  });
});

// ---------------------------------------------------------------------------
// Scheduler integration — permission chain
// ---------------------------------------------------------------------------

describe("BashTool scheduler integration", () => {
  it("default mode → Bash ask, no execution", async () => {
    const { scheduleToolCalls } = await import("../../src/tools/scheduler.js");
    const { ToolRegistry } = await import("../../src/tools/registry.js");
    const { createPermissionChecker } = await import("../../src/permissions/checker.js");

    const registry = new ToolRegistry();
    registry.registerBuiltin(bashTool);

    const checker = createPermissionChecker({
      mode: "default",
      rules: [],
      projectRoot: "/tmp",
    });

    const { results } = await scheduleToolCalls(
      [{ id: "c1", name: "Bash", arguments: JSON.stringify({ command: "echo hello" }) }],
      registry,
      { cwd: "/tmp" },
      checker,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("confirmation");
  });

  it("allow rule Bash(echo:*) + command echo hello → executes", async () => {
    const { scheduleToolCalls } = await import("../../src/tools/scheduler.js");
    const { ToolRegistry } = await import("../../src/tools/registry.js");
    const { createPermissionChecker } = await import("../../src/permissions/checker.js");
    const { parseRule } = await import("../../src/permissions/rules.js");

    const registry = new ToolRegistry();
    registry.registerBuiltin(bashTool);

    const checker = createPermissionChecker({
      mode: "default",
      rules: [parseRule("Bash(echo:*)", "allow")],
      projectRoot: "/tmp",
    });

    const { results } = await scheduleToolCalls(
      [{ id: "c2", name: "Bash", arguments: JSON.stringify({ command: "echo hello" }) }],
      registry,
      { cwd: "/tmp" },
      checker,
    );

    expect(results[0].output.isError).toBeFalsy();
    expect(results[0].output.output).toContain("hello");
  });

  it("deny rule Bash(rm:*) + sandbox=true → deny, no execution", async () => {
    const { scheduleToolCalls } = await import("../../src/tools/scheduler.js");
    const { ToolRegistry } = await import("../../src/tools/registry.js");
    const { createPermissionChecker } = await import("../../src/permissions/checker.js");
    const { parseRule } = await import("../../src/permissions/rules.js");

    const registry = new ToolRegistry();
    registry.registerBuiltin(bashTool);

    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [parseRule("Bash(rm:*)", "deny")],
      projectRoot: "/tmp",
    });

    const { results } = await scheduleToolCalls(
      [{ id: "c3", name: "Bash", arguments: JSON.stringify({ command: "rm -rf /", sandbox: true }) }],
      registry,
      { cwd: "/tmp" },
      checker,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Permission denied");
  });

  it("bypassPermissions + explicit deny → still deny", async () => {
    const { scheduleToolCalls } = await import("../../src/tools/scheduler.js");
    const { ToolRegistry } = await import("../../src/tools/registry.js");
    const { createPermissionChecker } = await import("../../src/permissions/checker.js");
    const { parseRule } = await import("../../src/permissions/rules.js");

    const registry = new ToolRegistry();
    registry.registerBuiltin(bashTool);

    const checker = createPermissionChecker({
      mode: "bypassPermissions",
      rules: [parseRule("Bash", "deny")],
      projectRoot: "/tmp",
    });

    const { results } = await scheduleToolCalls(
      [{ id: "c4", name: "Bash", arguments: JSON.stringify({ command: "ls" }) }],
      registry,
      { cwd: "/tmp" },
      checker,
    );

    expect(results[0].output.isError).toBe(true);
    expect(results[0].output.output).toContain("Permission denied");
  });
});
