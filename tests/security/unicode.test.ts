import { describe, it, expect } from "vitest";
import { sanitizeUnicode } from "../../src/security/unicode.js";
import { MockProvider } from "../../src/engine/providers/base.js";
import { QueryEngine } from "../../src/engine/engine.js";
import type { StreamEvent, ProviderTool } from "../../src/engine/types.js";
import type { Provider } from "../../src/engine/providers/base.js";

describe("sanitizeUnicode", () => {
  it("leaves normal text unchanged", () => {
    const input = "Hello, world! 123 abc";
    expect(sanitizeUnicode(input)).toBe(input);
  });

  it("removes zero-width space (U+200B)", () => {
    const input = "Hello​World";
    expect(sanitizeUnicode(input)).toBe("HelloWorld");
  });

  it("removes zero-width non-joiner (U+200C)", () => {
    const input = "Hello‌World";
    expect(sanitizeUnicode(input)).toBe("HelloWorld");
  });

  it("removes zero-width joiner (U+200D)", () => {
    const input = "Hello‍World";
    expect(sanitizeUnicode(input)).toBe("HelloWorld");
  });

  it("removes left-to-right mark (U+200E) and right-to-left mark (U+200F)", () => {
    const input = "Hello‎‏World";
    expect(sanitizeUnicode(input)).toBe("HelloWorld");
  });

  it("removes line separator (U+2028) and paragraph separator (U+2029 equivalent range)", () => {
    const input = "Line1 Line2";
    expect(sanitizeUnicode(input)).toBe("Line1Line2");
  });

  it("normalizes narrow no-break space (U+202F) to regular space via NFKC", () => {
    // U+202F is NFKC-normalized to a regular space before hidden-char stripping
    const input = "Hello World";
    expect(sanitizeUnicode(input)).toBe("Hello World");
  });

  it("removes BOM / zero-width no-break space (U+FEFF)", () => {
    const input = "﻿Hello";
    expect(sanitizeUnicode(input)).toBe("Hello");
  });

  it("removes tag characters (U+E0001..U+E007F)", () => {
    // U+E0001 is a language tag character
    const input = "Hello\u{E0001}World";
    expect(sanitizeUnicode(input)).toBe("HelloWorld");
  });

  it("applies NFKC normalization", () => {
    // U+2160 is Roman numeral one, NFKC normalizes to "I"
    const input = "Ⅰ";
    expect(sanitizeUnicode(input)).toBe("I");
  });

  it("applies NFKC normalization for fullwidth characters", () => {
    // U+FF21 is fullwidth A, NFKC normalizes to "A"
    const input = "Ａ";
    expect(sanitizeUnicode(input)).toBe("A");
  });

  describe("JSON string cleaning", () => {
    it("cleans hidden characters inside JSON string values", () => {
      const input = JSON.stringify({ key: "Hello​World" });
      const result = sanitizeUnicode(input);
      const parsed = JSON.parse(result);
      expect(parsed.key).toBe("HelloWorld");
    });

    it("cleans nested JSON objects", () => {
      const input = JSON.stringify({
        outer: { inner: "Hidden​Char" },
      });
      const result = sanitizeUnicode(input);
      const parsed = JSON.parse(result);
      expect(parsed.outer.inner).toBe("HiddenChar");
    });

    it("cleans JSON arrays", () => {
      const input = JSON.stringify(["a​b", "c​d"]);
      const result = sanitizeUnicode(input);
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(["ab", "cd"]);
    });

    it("does not alter non-JSON text", () => {
      const input = "Not json { at all";
      expect(sanitizeUnicode(input)).toBe(input);
    });
  });

  describe("max iterations safety", () => {
    it("caps JSON cleaning at 10 levels of depth", () => {
      // Build a deeply nested object (20 levels)
      let obj: Record<string, unknown> = { value: "deep" };
      for (let i = 0; i < 20; i++) {
        obj = { child: obj };
      }
      const input = JSON.stringify(obj);
      // Should not throw and should return valid JSON
      const result = sanitizeUnicode(input);
      const parsed = JSON.parse(result);
      // The deepest value should still be accessible
      let current: Record<string, unknown> = parsed;
      for (let i = 0; i < 20; i++) {
        current = current.child as Record<string, unknown>;
      }
      expect(current.value).toBe("deep");
    });
  });

  describe("JSON key cleaning", () => {
    it("cleans hidden characters in JSON keys", () => {
      // key with zero-width space: "he​llo"
      const input = '{"he​llo":"world"}';
      const result = sanitizeUnicode(input);
      const parsed = JSON.parse(result);
      expect(parsed.hello).toBe("world");
    });

    it("cleans nested object keys", () => {
      const input = JSON.stringify({ outer: { "ke​y": "value" } });
      const result = sanitizeUnicode(input);
      const parsed = JSON.parse(result);
      expect(parsed.outer.key).toBe("value");
    });

    it("key collision: last value wins (consistent with JS object behavior)", () => {
      // Two keys that become identical after cleaning
      const input = '{"a":1,"a​":2}';
      const result = sanitizeUnicode(input);
      const parsed = JSON.parse(result);
      // Both keys clean to "a" — last one wins
      expect(parsed.a).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Unicode sanitization in QueryEngine — tool result cleaning
// ---------------------------------------------------------------------------

describe("Unicode sanitization in QueryEngine", () => {
  it("user input is sanitized before entering messages", async () => {
    const receivedMessages: unknown[][] = [];
    const provider: Provider = {
      name: "spy",
      capabilities: { toolUse: false, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat(messages) {
        receivedMessages.push([...messages]);
        yield { type: "text_delta" as const, text: "ok" };
        yield { type: "done" as const, reason: "completed" as const };
      },
    };

    const engine = new QueryEngine(provider);
    // User input with hidden character
    for await (const _ of engine.query("Hello​World")) { /* consume */ }

    // Provider should receive sanitized input
    const userMsg = receivedMessages[0]!.find((m: any) => m.role === "user");
    expect(userMsg.content).toBe("HelloWorld");
  });

  it("tool result is sanitized before entering second round provider messages", async () => {
    let round = 0;
    const receivedMessages: unknown[][] = [];

    const provider: Provider = {
      name: "tool-result-spy",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat(messages) {
        round++;
        receivedMessages.push([...messages]);
        if (round === 1) {
          yield { type: "tool_call_start" as const, id: "tc-1", name: "TestTool" };
          yield { type: "tool_call_args" as const, id: "tc-1", args_json: '{"x":"y"}' };
        } else {
          yield { type: "text_delta" as const, text: "done" };
          yield { type: "done" as const, reason: "completed" as const };
        }
      },
    };

    const { ToolRegistry } = await import("../../src/tools/registry.js");
    const { buildTool } = await import("../../src/tools/base.js");
    const registry = new ToolRegistry();
    // Tool returns text with hidden character
    registry.registerBuiltin(buildTool({
      name: "TestTool",
      description: "test",
      schema: { input: { type: "object" } },
      security: { readOnly: true, concurrencySafe: true, destructive: false },
      execute: async () => ({ output: "Hello​World" }), // zero-width space
    }));

    const engine = new QueryEngine(provider, {
      tools: registry.toProviderTools(),
      toolRegistry: registry,
    });

    for await (const _ of engine.query("test")) { /* consume */ }

    // Second round messages should contain sanitized tool result
    const secondRound = receivedMessages[1]!;
    const toolResultMsg = secondRound.find((m: any) => m.role === "tool");
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.result).toBe("HelloWorld"); // hidden char removed
    expect(toolResultMsg.result).not.toContain("​");
  });
});
