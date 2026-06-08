// Anthropic provider — adapts @anthropic-ai/sdk to the shared Provider interface

import Anthropic from "@anthropic-ai/sdk";
import type {
  ProviderMessage,
  ProviderTool,
  StreamEvent,
} from "../types.js";
import type { Provider } from "./base.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  /** Base URL override (e.g. for proxies). Default: SDK default. */
  baseURL?: string;
  /** Max output tokens. Default: 4096. */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Message conversion: internal → Anthropic SDK format
// ---------------------------------------------------------------------------

function toAnthropicContent(
  msg: ProviderMessage,
): Anthropic.MessageParam["content"] {
  switch (msg.role) {
    case "system":
      return msg.content;
    case "user":
      return msg.content;
    case "assistant": {
      if (!msg.toolCalls || msg.toolCalls.length === 0) {
        return msg.content;
      }
      // Mix text + tool_use content blocks
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (msg.content) {
        blocks.push({ type: "text", text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: JSON.parse(tc.arguments),
        });
      }
      return blocks;
    }
    case "tool": {
      return [
        {
          type: "tool_result",
          tool_use_id: msg.toolCallId,
          content: msg.result,
          is_error: msg.isError,
        },
      ];
    }
  }
}

function toAnthropicMessages(
  messages: ProviderMessage[],
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  let systemPrompt: string | undefined;

  for (const msg of messages) {
    if (msg.role === "system") {
      // Anthropic uses a top-level system parameter, not a message role.
      // Keep the last system message as the system prompt.
      systemPrompt = msg.content;
      continue;
    }
    result.push({
      role: msg.role === "tool" ? "user" : msg.role,
      content: toAnthropicContent(msg),
    });
  }

  return result;
}

function extractSystemPrompt(
  messages: ProviderMessage[],
): string | undefined {
  for (const msg of messages) {
    if (msg.role === "system") return msg.content;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Tool conversion: internal → Anthropic SDK format
// ---------------------------------------------------------------------------

function toAnthropicTools(
  tools: ProviderTool[],
): Anthropic.MessageCreateParams["tools"] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
}

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  readonly capabilities = {
    toolUse: true,
    streaming: true,
    vision: true,
    promptCache: true,
    extendedThinking: true,
  };

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 4096;
  }

  /** Expose the client for testing (mocked injection). */
  getClient(): Anthropic {
    return this.client;
  }

  async *chat(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const systemPrompt = extractSystemPrompt(messages);
    const apiMessages = toAnthropicMessages(messages);

    const params: Anthropic.MessageCreateParamsStreaming = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: apiMessages,
      ...(systemPrompt && { system: systemPrompt }),
      ...(tools.length > 0 && { tools: toAnthropicTools(tools) }),
      stream: true,
    };

    // Accumulate tool use blocks across deltas
    const toolUseBlocks = new Map<
      number,
      { id: string; name: string; inputJson: string }
    >();

    try {
      // Stream creation is inside try/catch so that SDK errors during
      // client.messages.stream() (e.g. auth failure) are mapped to
      // error + done events instead of throwing out of the generator.
      const stream = this.client.messages.stream(params, {
        signal: signal ?? undefined,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          const delta = event.delta;

          if (delta.type === "text_delta") {
            yield { type: "text_delta", text: delta.text };
          } else if (delta.type === "thinking_delta") {
            yield { type: "thinking_delta", text: delta.thinking };
          } else if (delta.type === "input_json_delta") {
            // Accumulate tool input JSON
            const idx = event.index;
            const existing = toolUseBlocks.get(idx);
            if (existing) {
              existing.inputJson += delta.partial_json;
            }
          }
        } else if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            toolUseBlocks.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: "",
            });
            yield {
              type: "tool_call_start",
              id: event.content_block.id,
              name: event.content_block.name,
            };
          }
        } else if (event.type === "content_block_stop") {
          // Finalize any tool_use block — emit accumulated arguments as
          // tool_call_args (model-issued arguments), NOT tool_call_result.
          const block = toolUseBlocks.get(event.index);
          if (block) {
            yield {
              type: "tool_call_args",
              id: block.id,
              args_json: block.inputJson,
            };
          }
        }
        // message_stop is handled by the stream ending naturally
      }

      yield { type: "done", reason: "completed" };
    } catch (e) {
      yield {
        type: "error",
        error: e instanceof Error ? e : new Error(String(e)),
      };
      yield { type: "done", reason: "error" };
    }
  }
}
