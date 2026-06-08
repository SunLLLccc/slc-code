// Core types for the slc-code query engine

// ---------------------------------------------------------------------------
// Tool types
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  toolCallId: string;
  result: string;
  isError?: boolean;
}

export interface ProviderTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Unified message format
// ---------------------------------------------------------------------------

export type ProviderMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; result: string; isError?: boolean };

// ---------------------------------------------------------------------------
// Stream events
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_args"; id: string; args_json: string }
  | { type: "tool_call_result"; id: string; result: string; isError?: boolean }
  | { type: "thinking_delta"; text: string }
  | { type: "error"; error: Error }
  | { type: "done"; reason: "completed" | "max_turns" | "error" };

// ---------------------------------------------------------------------------
// Provider capabilities
// ---------------------------------------------------------------------------

export interface ProviderCapabilities {
  toolUse: boolean;
  streaming: boolean;
  vision: boolean;
  promptCache: boolean;
  extendedThinking: boolean;
}
