import { describe, it, expect } from "vitest";
import { MockProvider } from "../../src/engine/providers/base.js";
import { query } from "../../src/engine/query.js";
import { collectText, isDone, isTextDelta } from "../../src/engine/events.js";
import { QueryEngine } from "../../src/engine/engine.js";
import type { StreamEvent, ProviderCapabilities, ProviderTool } from "../../src/engine/types.js";
import type { Provider } from "../../src/engine/providers/base.js";

// ---------------------------------------------------------------------------
// Mock Provider
// ---------------------------------------------------------------------------

describe("MockProvider", () => {
  it("yields text_delta events then a done event", async () => {
    const provider = new MockProvider();
    const events: StreamEvent[] = [];
    for await (const event of provider.chat([], [])) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toEqual({ type: "text_delta", text: "Hello, world!" });
    expect(events.at(-1)).toEqual({ type: "done", reason: "completed" });
  });

  it("yields custom chunks", async () => {
    const provider = new MockProvider({
      chunks: ["Hello", ", ", "world!"],
    });
    const events: StreamEvent[] = [];
    for await (const event of provider.chat([], [])) {
      events.push(event);
    }

    const textEvents = events.filter(isTextDelta);
    expect(textEvents.map((e) => e.text)).toEqual(["Hello", ", ", "world!"]);
  });
});

// ---------------------------------------------------------------------------
// query()
// ---------------------------------------------------------------------------

describe("query()", () => {
  it("streams text_delta then done from mock provider", async () => {
    const provider = new MockProvider({ chunks: ["Hi"] });
    const events: StreamEvent[] = [];
    for await (const event of query(provider, [])) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "text_delta", text: "Hi" });
    const doneEvents = events.filter(isDone);
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].reason).toBe("completed");
  });

  it("collects text correctly via collectText helper", async () => {
    const provider = new MockProvider({ chunks: ["foo", "bar", "baz"] });
    const text = await collectText(query(provider, []));
    expect(text).toBe("foobarbaz");
  });

  it("yields done with reason 'error' when provider throws", async () => {
    const provider = new (class {
      readonly name = "failing";
      readonly capabilities = {
        toolUse: true,
        streaming: true,
        vision: true,
        promptCache: true,
        extendedThinking: true,
      };
      async *chat() {
        throw new Error("boom");
      }
    })() as unknown as Parameters<typeof query>[0];

    const events: StreamEvent[] = [];
    for await (const event of query(provider, [])) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "done", reason: "error" });
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent && errorEvent.type === "error") {
      expect(errorEvent.error.message).toBe("boom");
    }
  });

  it("respects maxTurns option", async () => {
    // Mock provider that always succeeds — with maxTurns=1 the query
    // should complete normally since the mock emits done after one turn.
    const provider = new MockProvider({ chunks: ["ok"] });
    const events: StreamEvent[] = [];
    for await (const event of query(provider, [], { maxTurns: 1 })) {
      events.push(event);
    }
    const doneEvents = events.filter(isDone);
    expect(doneEvents[0].reason).toBe("completed");
  });

  it("filters thinking_delta when provider capabilities.extendedThinking=false", async () => {
    // Provider emits thinking_delta even though it claims no extendedThinking.
    // query() must filter these out on the main path.
    const provider: Provider = {
      name: "thinking-mock",
      capabilities: {
        toolUse: true,
        streaming: true,
        vision: true,
        promptCache: true,
        extendedThinking: false,
      },
      async *chat() {
        yield { type: "thinking_delta", text: "internal thought" };
        yield { type: "text_delta", text: "visible" };
        yield { type: "done", reason: "completed" as const };
      },
    };

    const events: StreamEvent[] = [];
    for await (const event of query(provider, [])) {
      events.push(event);
    }

    // thinking_delta should be filtered out
    expect(events.some((e) => e.type === "thinking_delta")).toBe(false);
    // text_delta and done should pass through
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("yields done when provider emits tool_call_start without done", async () => {
    // Provider sends tool_call_start but never emits done.
    // query() must guarantee a terminal done event.
    const provider: Provider = {
      name: "tool-no-done",
      capabilities: {
        toolUse: true,
        streaming: true,
        vision: true,
        promptCache: true,
        extendedThinking: true,
      },
      async *chat() {
        yield { type: "text_delta", text: "let me check" };
        yield { type: "tool_call_start", id: "t1", name: "Read" };
        // No done event!
      },
    };

    const events: StreamEvent[] = [];
    for await (const event of query(provider, [])) {
      events.push(event);
    }

    const doneEvents = events.filter(isDone);
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].reason).toBe("completed");
  });

  it("does not duplicate done when provider already emitted done", async () => {
    // Provider emits done after tool_call_start.
    // query() must not emit a second done.
    const provider: Provider = {
      name: "tool-with-done",
      capabilities: {
        toolUse: true,
        streaming: true,
        vision: true,
        promptCache: true,
        extendedThinking: true,
      },
      async *chat() {
        yield { type: "tool_call_start", id: "t1", name: "Read" };
        yield { type: "done", reason: "completed" as const };
      },
    };

    const events: StreamEvent[] = [];
    for await (const event of query(provider, [])) {
      events.push(event);
    }

    const doneEvents = events.filter(isDone);
    expect(doneEvents).toHaveLength(1);
  });

  it("yields done with reason max_turns when maxTurns is 1 and provider never emits done", async () => {
    // Provider loops without emitting done — maxTurns=1 should catch it.
    let callCount = 0;
    const provider: Provider = {
      name: "looping",
      capabilities: {
        toolUse: true,
        streaming: true,
        vision: true,
        promptCache: true,
        extendedThinking: true,
      },
      async *chat() {
        callCount++;
        yield { type: "tool_call_start", id: `t${callCount}`, name: "Loop" };
        // No done — force the query loop to iterate
      },
    };

    const events: StreamEvent[] = [];
    for await (const event of query(provider, [], { maxTurns: 1 })) {
      events.push(event);
    }

    const doneEvents = events.filter(isDone);
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].reason).toBe("max_turns");
  });

  it("passes messages to provider", async () => {
    let received: unknown[] = [];
    const provider = new (class {
      readonly name = "spy";
      readonly capabilities = {
        toolUse: true,
        streaming: true,
        vision: true,
        promptCache: true,
        extendedThinking: true,
      };
      async *chat(messages: unknown[]) {
        // Snapshot immediately — query() may mutate the array afterward
        received = [...messages];
        yield { type: "text_delta" as const, text: "seen" };
        yield { type: "done" as const, reason: "completed" as const };
      }
    })() as unknown as Parameters<typeof query>[0];

    const msgs = [
      { role: "system" as const, content: "You are helpful." },
      { role: "user" as const, content: "Hi" },
    ];
    for await (const _ of query(provider, msgs)) {
      // consume
    }
    expect(received).toEqual(msgs);
  });
});

// ---------------------------------------------------------------------------
// QueryEngine
// ---------------------------------------------------------------------------

describe("QueryEngine", () => {
  it("maintains conversation state across multiple queries", async () => {
    const provider = new MockProvider({ chunks: ["response"] });
    const engine = new QueryEngine(provider);

    // First query
    const events1: StreamEvent[] = [];
    for await (const event of engine.query("Hello")) {
      events1.push(event);
    }
    const text1 = await collectText(
      (async function* () {
        for (const e of events1) yield e;
      })(),
    );
    expect(text1).toBe("response");

    // Second query
    const events2: StreamEvent[] = [];
    for await (const event of engine.query("How are you?")) {
      events2.push(event);
    }
    const text2 = await collectText(
      (async function* () {
        for (const e of events2) yield e;
      })(),
    );
    expect(text2).toBe("response");

    // Messages should have both user messages and both assistant responses
    const messages = engine.getMessages();
    expect(messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "response" },
      { role: "user", content: "How are you?" },
      { role: "assistant", content: "response" },
    ]);
  });

  it("reset() clears message history", async () => {
    const provider = new MockProvider();
    const engine = new QueryEngine(provider);

    for await (const _ of engine.query("Hello")) {
      // consume
    }
    expect(engine.getMessages().length).toBeGreaterThan(0);

    engine.reset();
    expect(engine.getMessages()).toEqual([]);
  });

  it("getMessages() returns a snapshot (not a reference)", async () => {
    const provider = new MockProvider();
    const engine = new QueryEngine(provider);

    const snapshot = engine.getMessages();
    snapshot.push({ role: "user", content: "injected" });

    expect(engine.getMessages()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Event ordering
// ---------------------------------------------------------------------------

describe("event ordering", () => {
  it("text_delta events come before done event", async () => {
    const provider = new MockProvider({ chunks: ["a", "b", "c"] });
    const events: StreamEvent[] = [];
    for await (const event of query(provider, [])) {
      events.push(event);
    }

    const lastEvent = events.at(-1)!;
    expect(lastEvent.type).toBe("done");

    // All text_delta events should come before the done event
    const doneIndex = events.findIndex((e) => e.type === "done");
    const lastTextDeltaIndex = Math.max(
      ...events
        .map((e, i) => (e.type === "text_delta" ? i : -1))
        .filter((i) => i >= 0),
    );
    expect(lastTextDeltaIndex).toBeLessThan(doneIndex);
  });

  it("events arrive in sequential order", async () => {
    const provider = new MockProvider({ chunks: ["first", "second"] });
    const events: StreamEvent[] = [];
    for await (const event of query(provider, [])) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toEqual(["text_delta", "text_delta", "done"]);
  });
});
