// Tests for preflight handler — deterministic local intercept for greetings

import { describe, it, expect, vi } from "vitest";
import {
  classifyPreflightIntent,
  getGreetingResponse,
} from "../../src/engine/preflight.js";
import { query } from "../../src/engine/query.js";
import type { Provider, ProviderCapabilities } from "../../src/engine/providers/base.js";
import type { StreamEvent } from "../../src/engine/types.js";

// ---------------------------------------------------------------------------
// classifyPreflightIntent
// ---------------------------------------------------------------------------

describe("classifyPreflightIntent", () => {
  // --- Greetings ---
  it.each([
    "你好",
    "hello",
    "hi",
    "嗨",
    "早上好",
    "晚上好",
    "你好呀",
    "hello!",
    "hi!",
    "你好！",
    " Hello ",
    " hi ",
    "hey",
    "早上好！",
    "good morning",
    "good afternoon",
    "good evening",
  ])("classifies %j as greeting", (input) => {
    expect(classifyPreflightIntent(input)).toBe("greeting");
  });

  // --- Model questions ---
  it.each([
    "你是什么模型",
    "你用的什么模型",
    "你用什么模型",
    "你是什么大模型",
    "what model are you using",
    "which model are you",
    "what LLM are you",
    "what are you powered by",
    "what's your model",
  ])("classifies %j as model_question", (input) => {
    expect(classifyPreflightIntent(input)).toBe("model_question");
  });

  // --- Normal tasks (should NOT be intercepted) ---
  it.each([
    "你好，帮我看看这个报错",
    "hello, fix this test",
    "你是谁并帮我改代码",
    "hi can you help me with this",
    "你好 请帮我写个函数",
    "帮我写代码",
    "fix the bug in main.ts",
    "what is the capital of France",
    "",
    "   ",
  ])("classifies %j as none", (input) => {
    expect(classifyPreflightIntent(input)).toBe("none");
  });

  // --- Edge cases ---
  it("does not intercept greetings with task content", () => {
    expect(classifyPreflightIntent("你好，帮我修一下测试")).toBe("none");
    expect(classifyPreflightIntent("hello, can you help me")).toBe("none");
    expect(classifyPreflightIntent("hi please fix this")).toBe("none");
  });

  it("model_question takes priority over greeting", () => {
    expect(classifyPreflightIntent("你好，你是什么模型")).toBe("model_question");
  });
});

// ---------------------------------------------------------------------------
// getGreetingResponse
// ---------------------------------------------------------------------------

describe("getGreetingResponse", () => {
  it("returns Chinese response for Chinese input", () => {
    const response = getGreetingResponse("你好");
    expect(response).toContain("slc code");
    expect(response).toContain("终端编程助手");
    expect(response).not.toContain("MiMo");
    expect(response).not.toContain("ChatGPT");
  });

  it("returns English response for English input", () => {
    const response = getGreetingResponse("hello");
    expect(response).toContain("slc code");
    expect(response).toContain("terminal coding assistant");
    expect(response).not.toContain("MiMo");
    expect(response).not.toContain("ChatGPT");
  });

  it("returns Chinese response for mixed input with Chinese chars", () => {
    const response = getGreetingResponse("你好hello");
    expect(response).toContain("终端编程助手");
  });
});

// ---------------------------------------------------------------------------
// Integration: query() should short-circuit greetings
// ---------------------------------------------------------------------------

describe("query preflight integration", () => {
  // Helper: collect all events from the async generator
  async function collectEvents(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    for await (const event of gen) events.push(event);
    return events;
  }

  // Mock provider that records whether chat() was called
  function createMockProvider(): Provider & { chatCalled: boolean } {
    return {
      name: "mock",
      capabilities: { toolUse: false, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      chatCalled: false,
      async *chat() {
        this.chatCalled = true;
        yield { type: "text_delta", text: "should not reach here" };
        yield { type: "done", reason: "completed" };
      },
    };
  }

  it("returns fixed greeting for 你好 without calling provider", async () => {
    const provider = createMockProvider();
    const messages = [
      { role: "system" as const, content: "You are a test assistant." },
      { role: "user" as const, content: "你好" },
    ];

    const events = await collectEvents(query(provider, messages));

    expect(provider.chatCalled).toBe(false);
    const textEvents = events.filter((e) => e.type === "text_delta");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0]).toMatchObject({ type: "text_delta" });
    if (textEvents[0] && textEvents[0].type === "text_delta") {
      expect(textEvents[0].text).toContain("slc code");
    }
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("returns fixed greeting for hello without calling provider", async () => {
    const provider = createMockProvider();
    const messages = [
      { role: "user" as const, content: "hello" },
    ];

    const events = await collectEvents(query(provider, messages));

    expect(provider.chatCalled).toBe(false);
    const textEvents = events.filter((e) => e.type === "text_delta");
    expect(textEvents).toHaveLength(1);
    if (textEvents[0] && textEvents[0].type === "text_delta") {
      expect(textEvents[0].text).toContain("slc code");
      expect(textEvents[0].text).toContain("terminal coding assistant");
    }
  });

  it("does NOT intercept '你好，帮我修一下测试' — calls provider", async () => {
    const provider = createMockProvider();
    const messages = [
      { role: "user" as const, content: "你好，帮我修一下测试" },
    ];

    await collectEvents(query(provider, messages));

    expect(provider.chatCalled).toBe(true);
  });

  it("does NOT intercept '你是什么模型' — calls provider", async () => {
    const provider = createMockProvider();
    const messages = [
      { role: "user" as const, content: "你是什么模型" },
    ];

    await collectEvents(query(provider, messages));

    expect(provider.chatCalled).toBe(true);
  });

  it("does NOT intercept 'what model are you using' — calls provider", async () => {
    const provider = createMockProvider();
    const messages = [
      { role: "user" as const, content: "what model are you using" },
    ];

    await collectEvents(query(provider, messages));

    expect(provider.chatCalled).toBe(true);
  });

  it("greeting with punctuation still intercepts", async () => {
    const provider = createMockProvider();
    const messages = [
      { role: "user" as const, content: "你好！" },
    ];

    const events = await collectEvents(query(provider, messages));

    expect(provider.chatCalled).toBe(false);
    const textEvents = events.filter((e) => e.type === "text_delta");
    expect(textEvents).toHaveLength(1);
  });

  it("intercepts greeting in multi-turn conversation (last user message)", async () => {
    const provider = createMockProvider();
    const messages = [
      { role: "system" as const, content: "You are a test assistant." },
      { role: "user" as const, content: "帮我写代码" },
      { role: "assistant" as const, content: "好的，我来帮你写代码。" },
      { role: "user" as const, content: "hi" },
    ];

    const events = await collectEvents(query(provider, messages));

    expect(provider.chatCalled).toBe(false);
    const textEvents = events.filter((e) => e.type === "text_delta");
    expect(textEvents).toHaveLength(1);
  });
});
