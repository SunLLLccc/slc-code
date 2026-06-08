// Tests for session memory lifecycle

import { describe, it, expect } from "vitest";
import type { ProviderMessage } from "../../src/engine/types.js";
import {
  shouldCreateSessionMemory,
  buildSessionMemoryContent,
} from "../../src/memory/session-memory-lifecycle.js";

function makeMessages(count: number, contentLength: number = 100): ProviderMessage[] {
  const messages: ProviderMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(contentLength),
    });
  }
  return messages;
}

describe("shouldCreateSessionMemory", () => {
  it("returns false for small conversations", () => {
    const messages = makeMessages(5, 100); // ~500 chars ≈ 125 tokens
    expect(shouldCreateSessionMemory(messages)).toBe(false);
  });

  it("returns true when exceeding token threshold", () => {
    // 10000 tokens * 4 chars/token = 40000 chars needed
    const messages = makeMessages(100, 400); // ~40000 chars
    expect(shouldCreateSessionMemory(messages)).toBe(true);
  });

  it("handles tool messages without content", () => {
    const messages: ProviderMessage[] = [
      { role: "tool", toolCallId: "tc-1", result: "x".repeat(40000) },
    ];
    // tool messages have `result` not `content`, but our helper handles both
    expect(shouldCreateSessionMemory(messages)).toBe(true);
  });
});

describe("buildSessionMemoryContent", () => {
  it("creates fallback summary when no patterns match", () => {
    const messages: ProviderMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const content = buildSessionMemoryContent(messages);
    expect(content).toContain("Session Memory");
    expect(content).toContain("Hello");
  });

  it("extracts memories from conversation with patterns", () => {
    const messages: ProviderMessage[] = [
      { role: "user", content: "I prefer using TypeScript for all projects" },
      { role: "assistant", content: "Got it, I'll use TypeScript." },
    ];
    const content = buildSessionMemoryContent(messages);
    expect(content).toContain("Session Memory");
  });
});
