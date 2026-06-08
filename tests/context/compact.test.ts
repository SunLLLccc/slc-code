import { describe, it, expect, vi } from "vitest";
import { compactMessages } from "../../src/context/compact.js";
import { ContextManager } from "../../src/context/manager.js";
import { buildReinjectMessages } from "../../src/context/re-inject.js";
import { compactCommand } from "../../src/commands/builtin/compact.js";
import type { ProviderMessage } from "../../src/engine/types.js";
import type { CommandContext } from "../../src/commands/registry.js";

function makeMsg(
  role: ProviderMessage["role"],
  content: string,
): ProviderMessage {
  if (role === "system") return { role: "system", content };
  if (role === "user") return { role: "user", content };
  return { role: "assistant", content };
}

describe("compactMessages", () => {
  it("keeps system messages intact", () => {
    const messages: ProviderMessage[] = [
      makeMsg("system", "You are a helpful assistant"),
      ...Array.from({ length: 15 }, (_, i) => makeMsg("user", `msg ${i}`)),
    ];
    const result = compactMessages(messages);
    expect(result[0]).toEqual(makeMsg("system", "You are a helpful assistant"));
  });

  it("keeps last 10 non-system messages", () => {
    const nonSystem: ProviderMessage[] = Array.from({ length: 15 }, (_, i) =>
      makeMsg("user", `msg ${i}`),
    );
    const messages: ProviderMessage[] = [
      makeMsg("system", "sys"),
      ...nonSystem,
    ];
    const result = compactMessages(messages);
    // Should have: 1 system + 1 summary + 10 kept = 12
    expect(result).toHaveLength(12);
    // Last 10 should be messages 5-14
    expect(result[result.length - 1]).toEqual(makeMsg("user", "msg 14"));
    expect(result[result.length - 10]).toEqual(makeMsg("user", "msg 5"));
  });

  it("creates summary placeholder for older messages", () => {
    const nonSystem: ProviderMessage[] = Array.from({ length: 15 }, (_, i) =>
      makeMsg("user", `msg ${i}`),
    );
    const messages: ProviderMessage[] = [
      makeMsg("system", "sys"),
      ...nonSystem,
    ];
    const result = compactMessages(messages);
    // The summary should be right after system messages
    const summary = result[1];
    expect(summary.role).toBe("system");
    expect(summary.content).toContain("5 earlier messages");
  });

  it("returns messages as-is when count is at or below KEEP_LAST", () => {
    const messages: ProviderMessage[] = [
      makeMsg("system", "sys"),
      ...Array.from({ length: 10 }, (_, i) => makeMsg("user", `msg ${i}`)),
    ];
    const result = compactMessages(messages);
    expect(result).toEqual(messages);
  });
});

describe("ContextManager", () => {
  it("shouldCompact returns false for small conversations", () => {
    const manager = new ContextManager();
    const messages: ProviderMessage[] = [
      makeMsg("user", "Hello"),
      makeMsg("assistant", "Hi there"),
    ];
    expect(manager.shouldCompact(messages)).toBe(false);
  });

  it("shouldCompact returns true when exceeding maxTokens", () => {
    // Each char ~0.25 tokens, so 400000 chars ~ 100000 tokens (default max)
    const bigContent = "x".repeat(400_001);
    const manager = new ContextManager();
    const messages: ProviderMessage[] = [
      makeMsg("user", bigContent),
    ];
    expect(manager.shouldCompact(messages)).toBe(true);
  });

  it("respects custom maxTokens", () => {
    const manager = new ContextManager(100);
    // 500 chars / 4 = 125 tokens > 100
    const messages: ProviderMessage[] = [
      makeMsg("user", "x".repeat(500)),
    ];
    expect(manager.shouldCompact(messages)).toBe(true);
  });

  it("getState and setState work correctly", () => {
    const manager = new ContextManager();
    expect(manager.getState()).toEqual({});

    manager.setState({ currentFile: "src/index.ts" });
    expect(manager.getState()).toEqual({ currentFile: "src/index.ts" });

    // setState creates a copy
    const state = manager.getState();
    state.currentFile = "other.ts";
    expect(manager.getState().currentFile).toBe("src/index.ts");
  });
});

describe("buildReinjectMessages", () => {
  it("creates message for current file", () => {
    const result = buildReinjectMessages({ currentFile: "src/main.ts" });
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toContain("src/main.ts");
  });

  it("creates message for plan state", () => {
    const result = buildReinjectMessages({ planState: "planning phase 2" });
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain("planning phase 2");
  });

  it("creates message for MCP tools", () => {
    const result = buildReinjectMessages({ mcpTools: ["search", "fetch"] });
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain("search, fetch");
  });

  it("returns empty array for empty state", () => {
    const result = buildReinjectMessages({});
    expect(result).toEqual([]);
  });

  it("creates multiple messages for full state", () => {
    const result = buildReinjectMessages({
      currentFile: "a.ts",
      planState: "phase 1",
      mcpTools: ["tool1"],
    });
    expect(result).toHaveLength(3);
  });
});

describe("/compact command", () => {
  it("calls compactMessages when available", () => {
    const mockCompact = vi.fn();
    const context: CommandContext = {
      compactMessages: mockCompact,
    };
    const result = compactCommand.execute("", context);
    expect(mockCompact).toHaveBeenCalledOnce();
    expect(result).toBe("Conversation compacted.");
  });

  it("returns fallback when compactMessages not available", () => {
    const context: CommandContext = {};
    const result = compactCommand.execute("", context);
    expect(result).toBe("Compact not available.");
  });

  it("has alias 'c'", () => {
    expect(compactCommand.aliases).toContain("c");
  });
});
