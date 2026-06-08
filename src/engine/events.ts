// Type guards and helpers for StreamEvent

import type { StreamEvent } from "./types.js";

export function isTextDelta(
  event: StreamEvent,
): event is Extract<StreamEvent, { type: "text_delta" }> {
  return event.type === "text_delta";
}

export function isToolCallStart(
  event: StreamEvent,
): event is Extract<StreamEvent, { type: "tool_call_start" }> {
  return event.type === "tool_call_start";
}

export function isToolCallResult(
  event: StreamEvent,
): event is Extract<StreamEvent, { type: "tool_call_result" }> {
  return event.type === "tool_call_result";
}

export function isToolCallArgs(
  event: StreamEvent,
): event is Extract<StreamEvent, { type: "tool_call_args" }> {
  return event.type === "tool_call_args";
}

export function isThinkingDelta(
  event: StreamEvent,
): event is Extract<StreamEvent, { type: "thinking_delta" }> {
  return event.type === "thinking_delta";
}

export function isError(
  event: StreamEvent,
): event is Extract<StreamEvent, { type: "error" }> {
  return event.type === "error";
}

export function isDone(
  event: StreamEvent,
): event is Extract<StreamEvent, { type: "done" }> {
  return event.type === "done";
}

/** Collect all text from an async iterable of StreamEvents, until done. */
export async function collectText(
  events: AsyncIterable<StreamEvent>,
): Promise<string> {
  let text = "";
  for await (const event of events) {
    if (isTextDelta(event)) {
      text += event.text;
    }
    if (isDone(event)) {
      break;
    }
  }
  return text;
}
