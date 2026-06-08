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
// Permission inheritance — real tool call blocking
// ---------------------------------------------------------------------------

describe("AgentTool permission inheritance", () => {
  it("child tool call denied by parent permissionChecker", async () => {
    let toolExecuted = false;

    // Provider that emits a tool call in round 1, then final text in round 2
    let round = 0;
    const toolCallProvider: Provider = {
      name: "tool-calling-sub",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat() {
        round++;
        if (round === 1) {
          yield { type: "tool_call_start" as const, id: "tc-child-1", name: "DangerousTool" };
          yield { type: "tool_call_args" as const, id: "tc-child-1", args_json: '{"action":"delete"}' };
        } else {
          yield { type: "text_delta" as const, text: "Tool was blocked" };
          yield { type: "done" as const, reason: "completed" as const };
        }
      },
    };

    // Create a registry with a tool that records execution
    const { ToolRegistry } = await import("../../src/tools/registry.js");
    const { buildTool } = await import("../../src/tools/base.js");
    const registry = new ToolRegistry();
    registry.registerBuiltin(buildTool({
      name: "DangerousTool",
      description: "A dangerous tool",
      schema: { input: { type: "object", properties: { action: { type: "string" } } } },
      security: { readOnly: false, concurrencySafe: false, destructive: true },
      execute: async () => { toolExecuted = true; return { output: "destroyed" }; },
    }));

    // Parent permission checker denies everything
    const denyAll: PermissionChecker = () => "deny";

    setAgentContext({
      provider: toolCallProvider,
      sessionDir: testDir,
      toolRegistry: registry,
      permissionChecker: denyAll,
    });

    const result = await agentTool.execute({ prompt: "run dangerous tool" }, { cwd: "/tmp" });

    // Tool should NOT have been executed
    expect(toolExecuted).toBe(false);
    // Subagent should still return some text (from round 2)
    expect(result.output).toContain("Tool was blocked");
  });

  it("child tool call allowed by parent permissionChecker", async () => {
    let toolExecuted = false;

    let round = 0;
    const toolCallProvider: Provider = {
      name: "tool-calling-sub-allow",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat() {
        round++;
        if (round === 1) {
          yield { type: "tool_call_start" as const, id: "tc-child-2", name: "SafeTool" };
          yield { type: "tool_call_args" as const, id: "tc-child-2", args_json: '{"query":"test"}' };
        } else {
          yield { type: "text_delta" as const, text: "Tool executed successfully" };
          yield { type: "done" as const, reason: "completed" as const };
        }
      },
    };

    const { ToolRegistry } = await import("../../src/tools/registry.js");
    const { buildTool } = await import("../../src/tools/base.js");
    const registry = new ToolRegistry();
    registry.registerBuiltin(buildTool({
      name: "SafeTool",
      description: "A safe tool",
      schema: { input: { type: "object", properties: { query: { type: "string" } } } },
      security: { readOnly: true, concurrencySafe: true, destructive: false },
      execute: async () => { toolExecuted = true; return { output: "result" }; },
    }));

    // Parent permission checker allows everything
    const allowAll: PermissionChecker = () => "allow";

    setAgentContext({
      provider: toolCallProvider,
      sessionDir: testDir,
      toolRegistry: registry,
      permissionChecker: allowAll,
    });

    const result = await agentTool.execute({ prompt: "run safe tool" }, { cwd: "/tmp" });

    // Tool SHOULD have been executed
    expect(toolExecuted).toBe(true);
    expect(result.output).toContain("Tool executed successfully");
  });

  it("parent toolRegistry tools are declared to child provider", async () => {
    let receivedTools: Array<{ name: string }> = [];

    const spyProvider: Provider = {
      name: "spy-sub",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat(_messages, tools) {
        receivedTools = [...tools];
        yield { type: "text_delta" as const, text: "spied" };
        yield { type: "done" as const, reason: "completed" as const };
      },
    };

    const { ToolRegistry } = await import("../../src/tools/registry.js");
    const { buildTool } = await import("../../src/tools/base.js");
    const registry = new ToolRegistry();
    registry.registerBuiltin(buildTool({
      name: "ToolA",
      description: "A",
      schema: { input: { type: "object" } },
      security: { readOnly: true, concurrencySafe: true, destructive: false },
      execute: async () => ({ output: "a" }),
    }));
    registry.registerBuiltin(buildTool({
      name: "ToolB",
      description: "B",
      schema: { input: { type: "object" } },
      security: { readOnly: true, concurrencySafe: true, destructive: false },
      execute: async () => ({ output: "b" }),
    }));

    setAgentContext({
      provider: spyProvider,
      sessionDir: testDir,
      toolRegistry: registry,
    });

    await agentTool.execute({ prompt: "check tools" }, { cwd: "/tmp" });

    // Child provider should have received parent's tool declarations
    expect(receivedTools.map((t) => t.name)).toContain("ToolA");
    expect(receivedTools.map((t) => t.name)).toContain("ToolB");
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
