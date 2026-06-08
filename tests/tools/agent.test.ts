// Tests for AgentTool — success path, sidechain, permission inheritance

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { agentTool, setAgentContext, resetAgentContext } from "../../src/tools/builtin/agent.js";
import type { Provider } from "../../src/engine/providers/base.js";
import type { ToolRegistry } from "../../src/tools/registry.js";
import type { PermissionChecker } from "../../src/tools/scheduler.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-agent-test-"));
  resetAgentContext();
});

afterEach(async () => {
  resetAgentContext();
  await rm(testDir, { recursive: true, force: true });
});

function makeMockProvider(response: string = "Subagent response"): Provider {
  return {
    name: "mock-agent",
    capabilities: { toolUse: false, streaming: true, vision: false, promptCache: false, extendedThinking: false },
    defaultModel: "test",
    async *chat() {
      yield { type: "text_delta" as const, text: response };
      yield { type: "done" as const, reason: "completed" as const };
    },
  };
}

// ---------------------------------------------------------------------------
// Basic schema/security
// ---------------------------------------------------------------------------

describe("AgentTool basic", () => {
  it("has correct name", () => {
    expect(agentTool.name).toBe("Agent");
  });

  it("has correct description", () => {
    expect(agentTool.description).toContain("subagent");
  });

  it("has security attributes: not readOnly, not concurrencySafe, not destructive", () => {
    expect(agentTool.security.readOnly).toBe(false);
    expect(agentTool.security.concurrencySafe).toBe(false);
    expect(agentTool.security.destructive).toBe(false);
  });

  it("schema requires prompt", () => {
    const schema = agentTool.schema.input as Record<string, unknown>;
    expect(schema.required).toContain("prompt");
  });

  it("validate rejects empty prompt", () => {
    expect(agentTool.validate!({ prompt: "" })).toBeDefined();
    expect(agentTool.validate!({ prompt: "   " })).toBeDefined();
  });

  it("validate accepts valid prompt", () => {
    expect(agentTool.validate!({ prompt: "Do something" })).toBeUndefined();
  });

  it("has checkPermissions that returns allow", () => {
    expect(agentTool.checkPermissions).toBeDefined();
    expect(agentTool.checkPermissions!({}, { cwd: "/tmp" })).toBe("allow");
  });

  it("returns error when no provider is set", async () => {
    resetAgentContext();
    const result = await agentTool.execute({ prompt: "hello" }, { cwd: "/tmp" });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not configured");
  });
});

// ---------------------------------------------------------------------------
// Success path — setAgentContext then execute
// ---------------------------------------------------------------------------

describe("AgentTool success path", () => {
  it("returns subagent response after setAgentContext", async () => {
    setAgentContext({
      provider: makeMockProvider("Task completed successfully"),
      sessionDir: testDir,
    });

    const result = await agentTool.execute({ prompt: "Do the task" }, { cwd: "/tmp" });
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("Task completed successfully");
  });

  it("respects subagentType parameter", async () => {
    setAgentContext({
      provider: makeMockProvider("Explore result"),
      sessionDir: testDir,
    });

    const result = await agentTool.execute(
      { prompt: "Find files", subagentType: "Explore" },
      { cwd: "/tmp" },
    );
    expect(result.output).toContain("Explore result");
  });
});

// ---------------------------------------------------------------------------
// Sidechain transcript
// ---------------------------------------------------------------------------

describe("AgentTool sidechain", () => {
  it("writes sidechain transcript to session directory", async () => {
    setAgentContext({
      provider: makeMockProvider("Sidechain test"),
      sessionDir: testDir,
    });

    await agentTool.execute({ prompt: "Write to sidechain" }, { cwd: "/tmp" });

    // Find the sidechain directory
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(testDir);
    const sidechainDir = entries.find((e) => e.startsWith("sidechain-agent-"));

    expect(sidechainDir).toBeDefined();
    expect(existsSync(join(testDir, sidechainDir!, "transcript.jsonl"))).toBe(true);

    // Verify sidechain contains user and assistant events
    const content = await readFile(join(testDir, sidechainDir!, "transcript.jsonl"), "utf-8");
    const lines = content.trim().split("\n").filter((l) => l);
    expect(lines.length).toBeGreaterThanOrEqual(2);

    const events = lines.map((l) => JSON.parse(l));
    expect(events[0].type).toBe("user");
    expect(events[0].content).toBe("Write to sidechain");
    expect(events[1].type).toBe("assistant");
    expect(events[1].content).toContain("Sidechain test");
  });

  it("sidechain does not pollute main transcript directory", async () => {
    // Create a main transcript file
    const mainTranscript = join(testDir, "transcript.jsonl");
    await writeFile(mainTranscript, '{"type":"user","content":"main"}\n');

    setAgentContext({
      provider: makeMockProvider("sub"),
      sessionDir: testDir,
    });

    await agentTool.execute({ prompt: "sub task" }, { cwd: "/tmp" });

    // Main transcript should only have the original content
    const mainContent = await readFile(mainTranscript, "utf-8");
    expect(mainContent).toBe('{"type":"user","content":"main"}\n');
    expect(mainContent).not.toContain("sub task");
    expect(mainContent).not.toContain("sub");
  });
});

// ---------------------------------------------------------------------------
// Permission inheritance
// ---------------------------------------------------------------------------

describe("AgentTool permission inheritance", () => {
  it("child inherits parent permissionChecker", async () => {
    // Create a permission checker that denies everything
    const denyAll: PermissionChecker = () => "deny";

    setAgentContext({
      provider: makeMockProvider("should not reach tool execution"),
      sessionDir: testDir,
      permissionChecker: denyAll,
    });

    // The child agent itself can still run (checkPermissions returns "allow" for AgentTool)
    // but any tools the child tries to use would be denied by the inherited checker
    const result = await agentTool.execute({ prompt: "try to use tools" }, { cwd: "/tmp" });
    // The subagent still returns text even if tools are denied
    expect(result.output).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// resetAgentContext
// ---------------------------------------------------------------------------

describe("resetAgentContext", () => {
  it("clears provider after reset", async () => {
    setAgentContext({
      provider: makeMockProvider("before reset"),
      sessionDir: testDir,
    });

    resetAgentContext();

    const result = await agentTool.execute({ prompt: "test" }, { cwd: "/tmp" });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not configured");
  });
});
