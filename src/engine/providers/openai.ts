// OpenAI provider — adapts the openai SDK to the shared Provider interface

import OpenAI from "openai";
import type {
  ProviderMessage,
  ProviderTool,
  StreamEvent,
} from "../types.js";
import type { Provider } from "./base.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  /** Base URL override. Default: https://api.openai.com/v1 */
  baseURL?: string;
  /** Max output tokens. Default: 4096. */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Message conversion: internal → OpenAI SDK format
// ---------------------------------------------------------------------------

function toOpenAIMessages(
  messages: ProviderMessage[],
): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((msg): OpenAI.ChatCompletionMessageParam => {
    switch (msg.role) {
      case "system":
        return { role: "system", content: msg.content };
      case "user":
        return { role: "user", content: msg.content };
      case "assistant": {
        if (!msg.toolCalls || msg.toolCalls.length === 0) {
          return { role: "assistant", content: msg.content };
        }
        return {
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })),
        };
      }
      case "tool":
        return {
          role: "tool" as const,
          tool_call_id: msg.toolCallId,
          content: msg.result,
        };
    }
  });
}

// ---------------------------------------------------------------------------
// Tool conversion: internal → OpenAI SDK format
// ---------------------------------------------------------------------------

function toOpenAITools(
  tools: ProviderTool[],
): OpenAI.ChatCompletionTool[] | undefined {
  if (tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as OpenAI.FunctionParameters,
    },
  }));
}

// ---------------------------------------------------------------------------
// OpenAIProvider
// ---------------------------------------------------------------------------

export class OpenAIProvider implements Provider {
  readonly name = "openai";
  readonly capabilities = {
    toolUse: true,
    streaming: true,
    vision: true,
    promptCache: false,
    extendedThinking: false,
  };

  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: OpenAIProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 4096;
  }

  /** Expose the client for testing (mocked injection). */
  getClient(): OpenAI {
    return this.client;
  }

  async *chat(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const apiMessages = toOpenAIMessages(messages);
    const apiTools = toOpenAITools(tools);

    const params: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: this.model,
      messages: apiMessages,
      max_tokens: this.maxTokens,
      stream: true,
      ...(apiTools && { tools: apiTools }),
    };

    // State table: index → {id, name} for tracking tool calls across
    // multiple delta chunks that may not repeat the id/name.
    const toolCallState = new Map<number, { id: string; name: string }>();

    try {
      const stream = await this.client.chat.completions.create(params, {
        signal: signal ?? undefined,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        // Text content
        if (delta.content) {
          yield { type: "text_delta", text: delta.content };
        }

        // Tool calls — OpenAI streams tool call deltas with index-based grouping.
        // The first chunk for a tool call carries id + function.name;
        // subsequent chunks carry only function.arguments via the same index.
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            // Record or retrieve state for this index
            if (tc.id && tc.function?.name) {
              // First chunk for this tool call — record id + name
              toolCallState.set(tc.index, {
                id: tc.id,
                name: tc.function.name,
              });
              yield {
                type: "tool_call_start",
                id: tc.id,
                name: tc.function.name,
              };
            }

            // Arguments delta — emit as tool_call_args (model-issued arguments)
            if (tc.function?.arguments) {
              const state = toolCallState.get(tc.index);
              const id = state?.id ?? `tc_${tc.index}`;
              yield {
                type: "tool_call_args",
                id,
                args_json: tc.function.arguments,
              };
            }
          }
        }
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
