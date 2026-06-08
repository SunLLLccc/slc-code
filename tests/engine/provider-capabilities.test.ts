import { describe, it, expect } from "vitest";
import {
  filterToolsForCapabilities,
  filterEventForCapabilities,
} from "../../src/engine/providers/capabilities.js";
import { MockProvider } from "../../src/engine/providers/base.js";
import { query } from "../../src/engine/query.js";
import { filterStreamByCapabilities } from "../../src/engine/stream.js";
import type { ProviderCapabilities, ProviderTool, StreamEvent } from "../../src/engine/types.js";

// ---------------------------------------------------------------------------
// filterToolsForCapabilities
// ---------------------------------------------------------------------------

describe("filterToolsForCapabilities", () => {
  const tools: ProviderTool[] = [
    {
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object" },
    },
    {
      name: "write_file",
      description: "Write a file",
      parameters: { type: "object" },
    },
  ];

  it("returns tools when toolUse is true", () => {
    const caps: ProviderCapabilities = {
      toolUse: true,
      streaming: true,
      vision: true,
      promptCache: true,
      extendedThinking: true,
    };
    expect(filterToolsForCapabilities(tools, caps)).toEqual(tools);
  });

  it("returns empty array when toolUse is false", () => {
    const caps: ProviderCapabilities = {
      toolUse: false,
      streaming: true,
      vision: true,
      promptCache: true,
      extendedThinking: true,
    };
    expect(filterToolsForCapabilities(tools, caps)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterEventForCapabilities
// ---------------------------------------------------------------------------

describe("filterEventForCapabilities", () => {
  const fullCaps: ProviderCapabilities = {
    toolUse: true,
    streaming: true,
    vision: true,
    promptCache: true,
    extendedThinking: true,
  };

  const noThinkingCaps: ProviderCapabilities = {
    ...fullCaps,
    extendedThinking: false,
  };

  it("passes through text_delta events regardless of capabilities", () => {
    const event: StreamEvent = { type: "text_delta", text: "hello" };
    expect(filterEventForCapabilities(event, fullCaps)).toBe(event);
    expect(filterEventForCapabilities(event, noThinkingCaps)).toBe(event);
  });

  it("passes through thinking_delta when extendedThinking is true", () => {
    const event: StreamEvent = { type: "thinking_delta", text: "hmm" };
    expect(filterEventForCapabilities(event, fullCaps)).toBe(event);
  });

  it("filters out thinking_delta when extendedThinking is false", () => {
    const event: StreamEvent = { type: "thinking_delta", text: "hmm" };
    expect(filterEventForCapabilities(event, noThinkingCaps)).toBeNull();
  });

  it("passes through done events", () => {
    const event: StreamEvent = { type: "done", reason: "completed" };
    expect(filterEventForCapabilities(event, noThinkingCaps)).toBe(event);
  });
});

// ---------------------------------------------------------------------------
// MockProvider with restricted capabilities
// ---------------------------------------------------------------------------

describe("MockProvider with restricted capabilities", () => {
  it("reports custom capabilities", () => {
    const provider = new MockProvider({
      capabilities: {
        toolUse: false,
        extendedThinking: false,
      },
    });

    expect(provider.capabilities.toolUse).toBe(false);
    expect(provider.capabilities.extendedThinking).toBe(false);
    expect(provider.capabilities.streaming).toBe(true);
    expect(provider.capabilities.vision).toBe(true);
    expect(provider.capabilities.promptCache).toBe(true);
  });

  it("defaults to all capabilities enabled", () => {
    const provider = new MockProvider();
    expect(provider.capabilities).toEqual({
      toolUse: true,
      streaming: true,
      vision: true,
      promptCache: true,
      extendedThinking: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Capability fallback in query()
// ---------------------------------------------------------------------------

describe("capability fallback in query()", () => {
  it("does not crash with all capabilities disabled", async () => {
    const provider = new MockProvider({
      chunks: ["still works"],
      capabilities: {
        toolUse: false,
        streaming: false,
        vision: false,
        promptCache: false,
        extendedThinking: false,
      },
    });

    const events: StreamEvent[] = [];
    for await (const event of query(provider, [])) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "text_delta")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("passes empty tools to provider when toolUse is false", async () => {
    let receivedTools: unknown[] = [{ unexpected: true }]; // sentinel
    const provider = new (class {
      readonly name = "spy";
      readonly capabilities: ProviderCapabilities = {
        toolUse: false,
        streaming: true,
        vision: true,
        promptCache: true,
        extendedThinking: true,
      };
      async *chat(_msgs: unknown[], tools: unknown[]) {
        receivedTools = tools;
        yield { type: "text_delta" as const, text: "ok" };
        yield { type: "done" as const, reason: "completed" as const };
      }
    })() as unknown as Parameters<typeof query>[0];

    const tools: ProviderTool[] = [
      { name: "test", description: "test tool", parameters: {} },
    ];
    for await (const _ of query(provider, [], { tools })) {
      // consume
    }

    expect(receivedTools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterStreamByCapabilities
// ---------------------------------------------------------------------------

describe("filterStreamByCapabilities", () => {
  it("filters thinking_delta when extendedThinking is false", async () => {
    const noThinking: ProviderCapabilities = {
      toolUse: true,
      streaming: true,
      vision: true,
      promptCache: true,
      extendedThinking: false,
    };

    async function* source(): AsyncGenerator<StreamEvent> {
      yield { type: "thinking_delta", text: "internal" };
      yield { type: "text_delta", text: "hello" };
      yield { type: "done", reason: "completed" };
    }

    const events: StreamEvent[] = [];
    for await (const event of filterStreamByCapabilities(source(), noThinking)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "hello" },
      { type: "done", reason: "completed" },
    ]);
  });

  it("passes all events through when all capabilities are enabled", async () => {
    const allEnabled: ProviderCapabilities = {
      toolUse: true,
      streaming: true,
      vision: true,
      promptCache: true,
      extendedThinking: true,
    };

    async function* source(): AsyncGenerator<StreamEvent> {
      yield { type: "thinking_delta", text: "internal" };
      yield { type: "text_delta", text: "hello" };
      yield { type: "done", reason: "completed" };
    }

    const events: StreamEvent[] = [];
    for await (const event of filterStreamByCapabilities(source(), allEnabled)) {
      events.push(event);
    }

    expect(events.length).toBe(3);
  });
});
