// Query function — the core streaming loop

import type { ProviderMessage, ProviderTool, StreamEvent } from "./types.js";
import type { Provider } from "./providers/base.js";
import {
  filterToolsForCapabilities,
  filterEventForCapabilities,
} from "./providers/capabilities.js";
import { toError } from "../utils/errors.js";

export interface QueryOptions {
  maxTurns?: number;
  tools?: ProviderTool[];
  signal?: AbortSignal;
}

const DEFAULT_MAX_TURNS = 50;

/**
 * Execute a query against a provider, yielding stream events.
 *
 * Simplified loop for P2 (no tool execution):
 *  1. Call provider.chat() with capability-filtered tools
 *  2. Apply capability event filtering (e.g. drop thinking_delta when !extendedThinking)
 *  3. Collect assistant text from the stream
 *  4. Append assistant message to conversation
 *  5. Guarantee exactly one terminal done event per call
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

  let turnCount = 0;

  // We work on a mutable copy so the caller's array is not modified
  const conversation = [...messages];

  while (turnCount < maxTurns) {
    turnCount++;

    let assistantText = "";
    let hasToolCalls = false;
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
        // Detect tool calls
        if (event.type === "tool_call_start") {
          hasToolCalls = true;
        }

        yield event;
      }
    } catch (e) {
      yield { type: "error", error: toError(e) };
      yield { type: "done", reason: "error" };
      return;
    }

    // Append the assistant response to conversation
    if (assistantText) {
      conversation.push({
        role: "assistant",
        content: assistantText,
      });
    }

    // In P2, tool calls are not executed. If tool_calls were detected,
    // we would loop (P5 handles this). For now, complete after one turn.
    if (!hasToolCalls) {
      // Provider already emitted done — nothing more to add.
      return;
    }

    // Tool calls found but we can't execute yet (P5).
    // Guarantee a terminal done if the provider didn't emit one.
    if (turnCount >= maxTurns) {
      if (!providerEmittedDone) {
        yield { type: "done", reason: "max_turns" };
      }
      return;
    }

    // In P5, tool execution goes here. For P2, yield a done and end.
    if (!providerEmittedDone) {
      yield { type: "done", reason: "completed" };
    }
    return;
  }

  // Max turns reached without completing
  yield { type: "done", reason: "max_turns" };
}
