// Tests for real Anthropic, OpenAI, and OpenAI-compatible providers
// All tests use mocked SDK clients — no network dependency.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicProvider } from "../../src/engine/providers/anthropic.js";
import { OpenAIProvider } from "../../src/engine/providers/openai.js";
import {
  OpenAICompatibleProvider,
  createOpenAICompatibleProvider,
  probeCapabilities,
  CONSERVATIVE_CAPS,
} from "../../src/engine/providers/openai-compatible.js";
import {
  createProvider,
  createProviderWithProbe,
} from "../../src/engine/providers/factory.js";
import type { StreamEvent, ProviderTool } from "../../src/engine/types.js";
import type { ResolvedProvider } from "../../src/config/models.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all events from an async generator into an array. */
async function collectEvents(
  gen: AsyncGenerator<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Filter events by type. */
function filterEvents<T extends StreamEvent["type"]>(
  events: StreamEvent[],
  type: T,
): Extract<StreamEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<
    StreamEvent,
    { type: T }
  >[];
}

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

describe("AnthropicProvider", () => {
  it("reports correct name and capabilities", () => {
    const provider = new AnthropicProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
    });
    expect(provider.name).toBe("anthropic");
    expect(provider.capabilities.toolUse).toBe(true);
    expect(provider.capabilities.streaming).toBe(true);
    expect(provider.capabilities.vision).toBe(true);
    expect(provider.capabilities.promptCache).toBe(true);
    expect(provider.capabilities.extendedThinking).toBe(true);
  });

  it("streams text_delta events from mock stream", async () => {
    const provider = new AnthropicProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
    });

    const mockStream = (async function* (): AsyncGenerator<unknown> {
      yield {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      };
      yield {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: " world" },
      };
    })();

    provider.getClient().messages.stream = vi.fn().mockReturnValue(mockStream);

    const events = await collectEvents(provider.chat([], []));

    const textEvents = filterEvents(events, "text_delta");
    expect(textEvents.map((e) => e.text)).toEqual(["Hello", " world"]);

    const doneEvents = filterEvents(events, "done");
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].reason).toBe("completed");
  });

  it("emits tool_call_start + tool_call_args (not tool_call_result) for tool use", async () => {
    const provider = new AnthropicProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
    });

    const mockStream = (async function* (): AsyncGenerator<unknown> {
      yield {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "tool_123",
          name: "read_file",
        },
      };
      yield {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"path":' },
      };
      yield {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '"/tmp/f"}' },
      };
      yield {
        type: "content_block_stop",
        index: 1,
      };
    })();

    provider.getClient().messages.stream = vi.fn().mockReturnValue(mockStream);

    const events = await collectEvents(provider.chat([], []));

    // Must emit tool_call_start
    const startEvents = filterEvents(events, "tool_call_start");
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0].id).toBe("tool_123");
    expect(startEvents[0].name).toBe("read_file");

    // Must emit tool_call_args (model-issued arguments), NOT tool_call_result
    const argsEvents = filterEvents(events, "tool_call_args");
    expect(argsEvents).toHaveLength(1);
    expect(argsEvents[0].id).toBe("tool_123");
    expect(argsEvents[0].args_json).toBe('{"path":"/tmp/f"}');

    // Must NOT emit any tool_call_result
    const resultEvents = filterEvents(events, "tool_call_result");
    expect(resultEvents).toHaveLength(0);
  });

  it("streams thinking_delta events from mock stream", async () => {
    const provider = new AnthropicProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
    });

    const mockStream = (async function* (): AsyncGenerator<unknown> {
      yield {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me think..." },
      };
      yield {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "Answer" },
      };
    })();

    provider.getClient().messages.stream = vi.fn().mockReturnValue(mockStream);

    const events = await collectEvents(provider.chat([], []));

    const thinkEvents = filterEvents(events, "thinking_delta");
    expect(thinkEvents).toHaveLength(1);
    expect(thinkEvents[0].text).toBe("Let me think...");
  });

  it("yields error + done on stream iteration exception", async () => {
    const provider = new AnthropicProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
    });

    const mockStream = (async function* (): AsyncGenerator<unknown> {
      throw new Error("API rate limit");
    })();

    provider.getClient().messages.stream = vi.fn().mockReturnValue(mockStream);

    const events = await collectEvents(provider.chat([], []));

    const errorEvents = filterEvents(events, "error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].error.message).toBe("API rate limit");

    const doneEvents = filterEvents(events, "done");
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].reason).toBe("error");
  });

  it("yields error + done when stream creation throws", async () => {
    const provider = new AnthropicProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
    });

    // Simulate SDK throwing during messages.stream() call itself
    provider.getClient().messages.stream = vi
      .fn()
      .mockImplementation(() => {
        throw new Error("Auth failed");
      });

    const events = await collectEvents(provider.chat([], []));

    const errorEvents = filterEvents(events, "error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].error.message).toBe("Auth failed");

    const doneEvents = filterEvents(events, "done");
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].reason).toBe("error");
  });

  it("passes system message as top-level system parameter", async () => {
    const provider = new AnthropicProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
    });

    let capturedParams: unknown = null;
    const mockStream = (async function* (): AsyncGenerator<unknown> {})();

    provider.getClient().messages.stream = vi
      .fn()
      .mockImplementation((params: unknown) => {
        capturedParams = params;
        return mockStream;
      });

    const messages = [
      { role: "system" as const, content: "You are helpful." },
      { role: "user" as const, content: "Hi" },
    ];

    await collectEvents(provider.chat(messages, []));

    const params = capturedParams as Record<string, unknown>;
    expect(params.system).toBe("You are helpful.");
    const msgs = params.messages as Array<Record<string, unknown>>;
    expect(msgs.every((m) => m.role !== "system")).toBe(true);
  });

  it("converts tool messages correctly", async () => {
    const provider = new AnthropicProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
    });

    let capturedParams: unknown = null;
    const mockStream = (async function* (): AsyncGenerator<unknown> {})();

    provider.getClient().messages.stream = vi
      .fn()
      .mockImplementation((p: unknown) => {
        capturedParams = p;
        return mockStream;
      });

    const messages = [
      {
        role: "assistant" as const,
        content: "Let me check",
        toolCalls: [{ id: "t1", name: "read", arguments: '{"path":"/a"}' }],
      },
      {
        role: "tool" as const,
        toolCallId: "t1",
        result: "file contents",
      },
    ];

    await collectEvents(provider.chat(messages, []));

    const params = capturedParams as { messages: unknown[] };
    const toolMsg = params.messages[1] as {
      role: string;
      content: Array<{
        type: string;
        tool_use_id: string;
        content: string;
      }>;
    };
    expect(toolMsg.role).toBe("user");
    expect(toolMsg.content[0].type).toBe("tool_result");
    expect(toolMsg.content[0].tool_use_id).toBe("t1");
  });
});

// ---------------------------------------------------------------------------
// OpenAIProvider
// ---------------------------------------------------------------------------

describe("OpenAIProvider", () => {
  it("reports correct name and capabilities", () => {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o",
    });
    expect(provider.name).toBe("openai");
    expect(provider.capabilities.toolUse).toBe(true);
    expect(provider.capabilities.streaming).toBe(true);
    expect(provider.capabilities.vision).toBe(true);
    expect(provider.capabilities.promptCache).toBe(false);
    expect(provider.capabilities.extendedThinking).toBe(false);
  });

  it("streams text_delta events from mock stream", async () => {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o",
    });

    const mockStream = (async function* (): AsyncGenerator<unknown> {
      yield {
        choices: [{ delta: { content: "Hi" } }],
      };
      yield {
        choices: [{ delta: { content: " there" } }],
      };
    })();

    provider.getClient().chat.completions.create = vi
      .fn()
      .mockResolvedValue(mockStream);

    const events = await collectEvents(provider.chat([], []));

    const textEvents = filterEvents(events, "text_delta");
    expect(textEvents.map((e) => e.text)).toEqual(["Hi", " there"]);

    const doneEvents = filterEvents(events, "done");
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].reason).toBe("completed");
  });

  it("emits tool_call_start + tool_call_args for tool calls", async () => {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o",
    });

    const mockStream = (async function* (): AsyncGenerator<unknown> {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_abc",
                  function: { name: "read_file", arguments: "" },
                },
              ],
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '{"path":"/x"}' },
                },
              ],
            },
          },
        ],
      };
    })();

    provider.getClient().chat.completions.create = vi
      .fn()
      .mockResolvedValue(mockStream);

    const events = await collectEvents(provider.chat([], []));

    // tool_call_start
    const startEvents = filterEvents(events, "tool_call_start");
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0].id).toBe("call_abc");
    expect(startEvents[0].name).toBe("read_file");

    // tool_call_args (model-issued arguments), NOT tool_call_result
    const argsEvents = filterEvents(events, "tool_call_args");
    expect(argsEvents).toHaveLength(1);
    expect(argsEvents[0].id).toBe("call_abc");
    expect(argsEvents[0].args_json).toBe('{"path":"/x"}');

    // Must NOT emit any tool_call_result
    const resultEvents = filterEvents(events, "tool_call_result");
    expect(resultEvents).toHaveLength(0);
  });

  it("maintains consistent tool call id across multi-chunk deltas", async () => {
    // First chunk has id+name, subsequent chunks only have index+arguments.
    // The provider must use the original id for all events.
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o",
    });

    const mockStream = (async function* (): AsyncGenerator<unknown> {
      // Chunk 1: id + name
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_xyz",
                  function: { name: "bash", arguments: "" },
                },
              ],
            },
          },
        ],
      };
      // Chunk 2: only arguments (no id)
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '{"cmd":"' },
                },
              ],
            },
          },
        ],
      };
      // Chunk 3: more arguments (no id)
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: 'ls"}' },
                },
              ],
            },
          },
        ],
      };
    })();

    provider.getClient().chat.completions.create = vi
      .fn()
      .mockResolvedValue(mockStream);

    const events = await collectEvents(provider.chat([], []));

    const argsEvents = filterEvents(events, "tool_call_args");
    // Both args chunks must use the original id "call_xyz"
    expect(argsEvents).toHaveLength(2);
    expect(argsEvents[0].id).toBe("call_xyz");
    expect(argsEvents[1].id).toBe("call_xyz");
    expect(argsEvents[0].args_json).toBe('{"cmd":"');
    expect(argsEvents[1].args_json).toBe('ls"}');
  });

  it("yields error and done on stream exception", async () => {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o",
    });

    provider.getClient().chat.completions.create = vi
      .fn()
      .mockRejectedValue(new Error("Network error"));

    const events = await collectEvents(provider.chat([], []));

    const errorEvents = filterEvents(events, "error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].error.message).toBe("Network error");

    const doneEvents = filterEvents(events, "done");
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].reason).toBe("error");
  });

  it("passes tools in correct format", async () => {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o",
    });

    let capturedParams: unknown = null;
    const mockStream = (async function* (): AsyncGenerator<unknown> {})();

    provider.getClient().chat.completions.create = vi
      .fn()
      .mockImplementation((params: unknown) => {
        capturedParams = params;
        return Promise.resolve(mockStream);
      });

    const tools: ProviderTool[] = [
      {
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
        },
      },
    ];

    await collectEvents(provider.chat([], tools));

    const params = capturedParams as {
      tools?: Array<Record<string, unknown>>;
    };
    expect(params.tools).toBeDefined();
    expect(params.tools?.[0].type).toBe("function");
    const fn = params.tools?.[0].function as Record<string, unknown>;
    expect(fn.name).toBe("read_file");
  });

  it("converts assistant tool_calls messages correctly", async () => {
    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "gpt-4o",
    });

    let capturedParams: unknown = null;
    const mockStream = (async function* (): AsyncGenerator<unknown> {})();

    provider.getClient().chat.completions.create = vi
      .fn()
      .mockImplementation((params: unknown) => {
        capturedParams = params;
        return Promise.resolve(mockStream);
      });

    const messages = [
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [{ id: "t1", name: "bash", arguments: '{"cmd":"ls"}' }],
      },
      {
        role: "tool" as const,
        toolCallId: "t1",
        result: "file.txt",
      },
    ];

    await collectEvents(provider.chat(messages, []));

    const params = capturedParams as { messages: unknown[] };
    const assistantMsg = params.messages[0] as {
      role: string;
      tool_calls: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
    expect(assistantMsg.tool_calls[0].id).toBe("t1");
    expect(assistantMsg.tool_calls[0].function.name).toBe("bash");

    const toolMsg = params.messages[1] as {
      role: string;
      tool_call_id: string;
      content: string;
    };
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.tool_call_id).toBe("t1");
  });
});

// ---------------------------------------------------------------------------
// OpenAICompatibleProvider
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProvider", () => {
  it("reports correct name and conservative default capabilities", () => {
    const provider = new OpenAICompatibleProvider({
      model: "llama3",
      baseURL: "http://localhost:11434/v1",
    });
    expect(provider.name).toBe("openai-compatible");
    expect(provider.capabilities.toolUse).toBe(false);
    expect(provider.capabilities.streaming).toBe(true);
    expect(provider.capabilities.vision).toBe(false);
    expect(provider.capabilities.promptCache).toBe(false);
    expect(provider.capabilities.extendedThinking).toBe(false);
  });

  it("uses explicit capabilities when provided", () => {
    const provider = new OpenAICompatibleProvider({
      model: "llama3",
      baseURL: "http://localhost:11434/v1",
      capabilities: { toolUse: true, vision: true },
    });
    expect(provider.capabilities.toolUse).toBe(true);
    expect(provider.capabilities.vision).toBe(true);
  });

  it("delegates chat to OpenAIProvider", async () => {
    const provider = new OpenAICompatibleProvider({
      model: "llama3",
      baseURL: "http://localhost:11434/v1",
      capabilities: { toolUse: true },
    });

    const mockStream = (async function* (): AsyncGenerator<unknown> {
      yield {
        choices: [{ delta: { content: "from local" } }],
      };
    })();

    const delegate = provider as unknown as { delegate: OpenAIProvider };
    delegate.delegate.getClient().chat.completions.create = vi
      .fn()
      .mockResolvedValue(mockStream);

    const events = await collectEvents(provider.chat([], []));
    const textEvents = filterEvents(events, "text_delta");
    expect(textEvents.map((e) => e.text)).toEqual(["from local"]);
  });

});

// ---------------------------------------------------------------------------
// probeCapabilities (unit tests with mocked OpenAI client)
// ---------------------------------------------------------------------------

describe("probeCapabilities", () => {
  it("returns conservative caps when text probe fails (endpoint unreachable)", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error("Connection refused")),
        },
      },
    };

    const caps = await probeCapabilities(
      mockClient as unknown as import("openai").default,
      "llama3",
    );

    expect(caps).toEqual(CONSERVATIVE_CAPS);
    expect(caps.toolUse).toBe(false);
  });

  it("returns toolUse=false when text probe succeeds but tool probe fails", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation((params: { tools?: unknown[] }) => {
            if (params.tools) {
              throw new Error("Function calling not supported");
            }
            return Promise.resolve({});
          }),
        },
      },
    };

    const caps = await probeCapabilities(
      mockClient as unknown as import("openai").default,
      "llama3",
    );

    expect(caps.streaming).toBe(true);
    expect(caps.toolUse).toBe(false);
    // Verify both probes were attempted
    expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(2);
  });

  it("returns toolUse=true when both text and tool probes succeed", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({}),
        },
      },
    };

    const caps = await probeCapabilities(
      mockClient as unknown as import("openai").default,
      "llama3",
    );

    expect(caps.streaming).toBe(true);
    expect(caps.toolUse).toBe(true);
    // Verify both probes were attempted
    expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(2);
    // Verify the second call included a tool definition
    const secondCall = mockClient.chat.completions.create.mock.calls[1];
    expect(secondCall[0].tools).toBeDefined();
    expect(secondCall[0].tools[0].function.name).toBe("__slc_probe");
  });
});

// ---------------------------------------------------------------------------
// Provider Factory
// ---------------------------------------------------------------------------

describe("Provider Factory", () => {
  it("creates AnthropicProvider for anthropic", () => {
    const provider = createProvider({
      provider: {
        name: "anthropic",
        apiKey: "sk-test",
        defaultModel: "claude-sonnet-4-6",
        baseURL: undefined,
        apiKeyEnv: "SLC_ANTHROPIC_API_KEY",
      },
    });
    expect(provider.name).toBe("anthropic");
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("creates OpenAIProvider for openai", () => {
    const provider = createProvider({
      provider: {
        name: "openai",
        apiKey: "sk-test",
        defaultModel: "gpt-4o",
        baseURL: undefined,
        apiKeyEnv: "SLC_OPENAI_API_KEY",
      },
    });
    expect(provider.name).toBe("openai");
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("creates OpenAICompatibleProvider for openai-compatible", () => {
    const provider = createProvider({
      provider: {
        name: "openai-compatible",
        apiKey: undefined,
        defaultModel: "llama3",
        baseURL: "http://localhost:11434/v1",
        apiKeyEnv: "SLC_LOCAL_API_KEY",
      },
    });
    expect(provider.name).toBe("openai-compatible");
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it("createProviderWithProbe delegates to createProvider for non-compatible providers", async () => {
    const provider = await createProviderWithProbe({
      provider: {
        name: "anthropic",
        apiKey: "sk-test",
        defaultModel: "claude-sonnet-4-6",
        baseURL: undefined,
        apiKeyEnv: "SLC_ANTHROPIC_API_KEY",
      },
    });
    expect(provider.name).toBe("anthropic");
  });

  it("uses default baseURL for openai-compatible when none specified", () => {
    const provider = createProvider({
      provider: {
        name: "openai-compatible",
        apiKey: undefined,
        defaultModel: "llama3",
        baseURL: undefined,
        apiKeyEnv: undefined,
      },
    });
    expect(provider.name).toBe("openai-compatible");
  });
});
