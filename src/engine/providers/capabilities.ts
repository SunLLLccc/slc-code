// Capability degradation logic

import type { ProviderCapabilities, ProviderTool, StreamEvent } from "../types.js";

/**
 * Apply capability constraints to a tools array.
 * If the provider does not support tool use, return an empty array.
 */
export function filterToolsForCapabilities(
  tools: ProviderTool[],
  capabilities: ProviderCapabilities,
): ProviderTool[] {
  if (!capabilities.toolUse) {
    return [];
  }
  return tools;
}

/**
 * Filter stream events based on provider capabilities.
 * - No extendedThinking → skip thinking_delta events
 */
export function filterEventForCapabilities(
  event: StreamEvent,
  capabilities: ProviderCapabilities,
): StreamEvent | null {
  if (event.type === "thinking_delta" && !capabilities.extendedThinking) {
    return null;
  }
  return event;
}
