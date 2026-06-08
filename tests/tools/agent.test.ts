// Tests for AgentTool

import { describe, it, expect } from "vitest";
import { agentTool } from "../../src/tools/builtin/agent.js";

// ---------------------------------------------------------------------------
// AgentTool
// ---------------------------------------------------------------------------

describe("AgentTool", () => {
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

  it("schema defines prompt and subagentType properties", () => {
    const schema = agentTool.schema.input as Record<string, unknown>;
    const props = schema.properties as Record<string, unknown>;
    expect(props.prompt).toBeDefined();
    expect(props.subagentType).toBeDefined();
  });

  it("validate rejects empty prompt", () => {
    expect(agentTool.validate!({ prompt: "" })).toBeDefined();
    expect(agentTool.validate!({ prompt: "   " })).toBeDefined();
  });

  it("validate rejects missing prompt", () => {
    expect(agentTool.validate!({})).toBeDefined();
  });

  it("validate accepts valid prompt", () => {
    expect(agentTool.validate!({ prompt: "Do something" })).toBeUndefined();
  });

  it("has checkPermissions that returns allow", () => {
    expect(agentTool.checkPermissions).toBeDefined();
    expect(agentTool.checkPermissions!({}, { cwd: "/tmp" })).toBe("allow");
  });

  it("returns error when no provider is set", async () => {
    const result = await agentTool.execute({ prompt: "hello" }, { cwd: "/tmp" });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not configured");
  });
});
