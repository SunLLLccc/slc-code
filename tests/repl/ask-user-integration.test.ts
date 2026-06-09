// AskUser integration tests — full chain from provider tool call to user answer

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAskUserCallback,
  submitAskUserAnswers,
  cancelAskUser,
  getPendingQuestions,
  clearPendingQuestions,
} from "../../src/repl/ask-user-runtime.js";
import { askUserTool } from "../../src/tools/builtin/ask-user.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { buildTool, type ToolContext, type ToolInput, type ToolOutput } from "../../src/tools/base.js";
import { QueryEngine } from "../../src/engine/engine.js";
import type { Provider, StreamEvent } from "../../src/engine/types.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "ask-user-integration-"));
  clearPendingQuestions();
});

afterEach(async () => {
  clearPendingQuestions();
  await rm(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Full chain: provider → AskUser tool call → pending → user answer → tool_result
// ---------------------------------------------------------------------------

describe("AskUser full chain integration", () => {
  it("provider AskUser call → pending → submit real answer → tool_result with answer", async () => {
    // Provider that emits AskUser tool call in round 1, then finishes in round 2
    let round = 0;
    let receivedMessages: unknown[][] = [];

    const provider: Provider = {
      name: "ask-user-test",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat(messages) {
        round++;
        receivedMessages.push([...messages]);
        if (round === 1) {
          yield { type: "tool_call_start" as const, id: "tc-ask", name: "AskUser" };
          yield { type: "tool_call_args" as const, id: "tc-ask", args_json: '{"questions":["What is your name?"]}' };
        } else {
          // Round 2: should see the answer in tool_result
          yield { type: "text_delta" as const, text: "Nice to meet you!" };
          yield { type: "done" as const, reason: "completed" as const };
        }
      },
    };

    const registry = new ToolRegistry();
    registry.registerBuiltin(askUserTool);

    // Create the real askUser callback that waits for answers
    const askUser = createAskUserCallback();
    const toolContext: ToolContext = { cwd: testDir, askUser };

    const engine = new QueryEngine(provider, {
      tools: registry.toProviderTools(),
      toolRegistry: registry,
      toolContext,
    });

    // Start the query — it will hang waiting for AskUser answer
    const eventsPromise = (async () => {
      const events: StreamEvent[] = [];
      for await (const event of engine.query("Ask me something")) {
        events.push(event);
      }
      return events;
    })();

    // Wait for the question to be queued
    await new Promise((r) => setTimeout(r, 50));

    // Verify question is pending
    const pending = getPendingQuestions();
    expect(pending).toHaveLength(1);
    expect(pending[0].questions).toEqual(["What is your name?"]);

    // Submit real answer
    submitAskUserAnswers(pending[0].id, ["Alice"]);

    // Now the query should complete
    const events = await eventsPromise;

    // Verify the chain worked
    const toolResults = events.filter((e) => e.type === "tool_call_result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].result).toContain("Alice");
    expect(toolResults[0].result).not.toContain("no answer collected");

    // Provider round 2 should have received the tool result with Alice
    expect(receivedMessages).toHaveLength(2);
    const round2Messages = receivedMessages[1];
    const toolResultMsg = round2Messages.find((m: any) => m.role === "tool");
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.result).toContain("Alice");
  });

  it("provider AskUser call → cancel → tool_result isError", async () => {
    let round = 0;

    const provider: Provider = {
      name: "ask-cancel-test",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat() {
        round++;
        if (round === 1) {
          yield { type: "tool_call_start" as const, id: "tc-ask", name: "AskUser" };
          yield { type: "tool_call_args" as const, id: "tc-ask", args_json: '{"questions":["Pick a color"]}' };
        } else {
          yield { type: "text_delta" as const, text: "Cancelled" };
          yield { type: "done" as const, reason: "completed" as const };
        }
      },
    };

    const registry = new ToolRegistry();
    registry.registerBuiltin(askUserTool);

    const askUser = createAskUserCallback();
    const toolContext: ToolContext = { cwd: testDir, askUser };

    const engine = new QueryEngine(provider, {
      tools: registry.toProviderTools(),
      toolRegistry: registry,
      toolContext,
    });

    const eventsPromise = (async () => {
      const events: StreamEvent[] = [];
      for await (const event of engine.query("Ask me")) {
        events.push(event);
      }
      return events;
    })();

    await new Promise((r) => setTimeout(r, 50));

    const pending = getPendingQuestions();
    expect(pending).toHaveLength(1);

    // Cancel instead of answering
    cancelAskUser(pending[0].id);

    const events = await eventsPromise;
    const toolResults = events.filter((e) => e.type === "tool_call_result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].isError).toBe(true);
    expect(toolResults[0].result).toContain("cancelled");
  });
});

// ---------------------------------------------------------------------------
// Multi-question AskUser
// ---------------------------------------------------------------------------

describe("AskUser multi-question", () => {
  it("two questions → two real answers → tool_result contains both", async () => {
    let round = 0;
    const provider: Provider = {
      name: "multi-ask-test",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat() {
        round++;
        if (round === 1) {
          yield { type: "tool_call_start" as const, id: "tc-ask", name: "AskUser" };
          yield { type: "tool_call_args" as const, id: "tc-ask", args_json: '{"questions":["Name?","Goal?"]}' };
        } else {
          yield { type: "text_delta" as const, text: "Thanks!" };
          yield { type: "done" as const, reason: "completed" as const };
        }
      },
    };

    const registry = new ToolRegistry();
    registry.registerBuiltin(askUserTool);

    const askUser = createAskUserCallback();
    const engine = new QueryEngine(provider, {
      tools: registry.toProviderTools(),
      toolRegistry: registry,
      toolContext: { cwd: testDir, askUser },
    });

    const eventsPromise = (async () => {
      const events: StreamEvent[] = [];
      for await (const event of engine.query("Ask me two things")) {
        events.push(event);
      }
      return events;
    })();

    await new Promise((r) => setTimeout(r, 50));

    const pending = getPendingQuestions();
    expect(pending).toHaveLength(1);
    expect(pending[0].questions).toEqual(["Name?", "Goal?"]);

    // Submit both answers
    submitAskUserAnswers(pending[0].id, ["Alice", "Learn TypeScript"]);

    const events = await eventsPromise;
    const toolResults = events.filter((e) => e.type === "tool_call_result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].isError).toBeUndefined();
    expect(toolResults[0].result).toContain("Alice");
    expect(toolResults[0].result).toContain("Learn TypeScript");
  });

  it("two questions → wrong number of answers → isError", async () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(askUserTool);

    const ctx: ToolContext = { cwd: testDir, askUser: async () => ["only one"] };
    const result = await askUserTool.execute(
      { questions: ["Name?", "Goal?"] },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Expected 2 answers");
  });
});

// ---------------------------------------------------------------------------
// AskUser without callback (non-interactive fail closed)
// ---------------------------------------------------------------------------

describe("AskUser non-interactive fail closed", () => {
  it("no askUser callback → isError=true", async () => {
    const registry = new ToolRegistry();
    registry.registerBuiltin(askUserTool);

    const toolContext: ToolContext = { cwd: testDir }; // no askUser

    const result = await askUserTool.execute(
      { questions: ["What?"] },
      toolContext,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not available");
  });
});
