// Query function — the core streaming loop with tool execution

import type { ProviderMessage, ProviderTool, StreamEvent, ToolCall } from "./types.js";
import type { Provider } from "./providers/base.js";
import {
  filterToolsForCapabilities,
  filterEventForCapabilities,
} from "./providers/capabilities.js";
import { toError } from "../utils/errors.js";
import type { ToolRegistry } from "../tools/registry.js";
import { scheduleToolCalls, type ToolCall as SchedulerToolCall } from "../tools/scheduler.js";
import type { ToolContext } from "../tools/base.js";
import type { PermissionChecker } from "../tools/scheduler.js";

export interface QueryOptions {
  maxTurns?: number;
  tools?: ProviderTool[];
  signal?: AbortSignal;
  /** Tool registry for executing tool calls */
  toolRegistry?: ToolRegistry;
  /** Permission checker for tool execution */
  permissionChecker?: PermissionChecker;
  /** Tool context (cwd, etc.) */
  toolContext?: ToolContext;
}

const DEFAULT_MAX_TURNS = 50;

/**
 * Execute a query against a provider, yielding stream events.
 *
 * Full tool loop:
 *  1. Call provider.chat() with capability-filtered tools
 *  2. Apply capability event filtering
 *  3. Collect assistant text and tool calls from the stream
 *  4. If tool calls detected: execute via scheduler, inject results, loop
 *  5. If no tool calls: append assistant message and return
 *  6. Guarantee exactly one terminal done event per call
 */
export async function* query(
  provider: Provider,
  messages: ProviderMessage[],
  options?: QueryOptions,
): AsyncGenerator<StreamEvent> {
  const maxTurns = options?.maxTurns ?? DEFAULT_MAX_TURNS;
  const tools = filterToolsForCapabilities(
    options?.tools ?? [],
    provider.capabilities,
  );
  const signal = options?.signal;
  const caps = provider.capabilities;
  const registry = options?.toolRegistry;
  const permissionChecker = options?.permissionChecker;
  const toolContext = options?.toolContext ?? { cwd: process.cwd() };

  let turnCount = 0;

  // We work on a mutable copy so the caller's array is not modified
  const conversation = [...messages];

  while (turnCount < maxTurns) {
    turnCount++;

    let assistantText = "";
    const toolCalls: Array<{ id: string; name: string; argsJson: string }> = [];
    let providerEmittedDone = false;

    try {
      for await (const raw of provider.chat(conversation, tools, signal)) {
        // Apply capability filtering — drop events the provider shouldn't produce
        const event = filterEventForCapabilities(raw, caps);
        if (event === null) continue;

        // Track whether provider emitted a terminal done
        if (event.type === "done") {
          providerEmittedDone = true;
        }

        // Collect assistant text from text_delta events
        if (event.type === "text_delta") {
          assistantText += event.text;
        }

        // Collect tool calls
        if (event.type === "tool_call_start") {
          toolCalls.push({ id: event.id, name: event.name, argsJson: "" });
        }
        if (event.type === "tool_call_args" && toolCalls.length > 0) {
          toolCalls[toolCalls.length - 1]!.argsJson += event.args_json;
        }

        yield event;
      }
    } catch (e) {
      yield { type: "error", error: toError(e) };
      yield { type: "done", reason: "error" };
      return;
    }

    // Append the assistant response to conversation
    if (assistantText || toolCalls.length > 0) {
      if (assistantText) {
        conversation.push({ role: "assistant", content: assistantText });
      }
    }

    // If no tool calls, we're done — guarantee a terminal done
    if (toolCalls.length === 0) {
      if (!providerEmittedDone) {
        yield { type: "done", reason: "completed" };
      }
      return;
    }

    // If no registry, we can't execute tools — yield done and return
    if (!registry) {
      if (!providerEmittedDone) {
        yield { type: "done", reason: "completed" };
      }
      return;
    }

    // Execute tool calls via scheduler
    const schedulerCalls: SchedulerToolCall[] = toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.argsJson,
    }));

    try {
      const { results } = await scheduleToolCalls(
        schedulerCalls,
        registry,
        toolContext,
        permissionChecker,
      );

      // Inject tool results into conversation and yield events
      for (const result of results) {
        const toolResult: ProviderMessage = {
          role: "tool",
          toolCallId: result.toolCallId,
          result: result.output.output,
          isError: result.output.isError,
        };
        conversation.push(toolResult);

        // Yield tool_call_result event for the stream
        yield {
          type: "tool_call_result",
          id: result.toolCallId,
          result: result.output.output,
          isError: result.output.isError,
        };
      }
    } catch (e) {
      yield { type: "error", error: toError(e) };
      yield { type: "done", reason: "error" };
      return;
    }

    // Check max turns
    if (turnCount >= maxTurns) {
      if (!providerEmittedDone) {
        yield { type: "done", reason: "max_turns" };
      }
      return;
    }

    // Loop back to get next provider response with tool results
  }

  // Max turns reached without completing
  yield { type: "done", reason: "max_turns" };
}
