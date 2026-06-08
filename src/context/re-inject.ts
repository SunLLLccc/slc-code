// Re-inject — restore context state after compaction

import type { ProviderMessage } from "../engine/types.js";
import type { ContextState } from "./manager.js";

/**
 * Build system messages to re-inject context state after compact.
 */
export function buildReinjectMessages(state: ContextState): ProviderMessage[] {
  const messages: ProviderMessage[] = [];

  if (state.currentFile) {
    messages.push({
      role: "system",
      content: `Currently viewing: ${state.currentFile}`,
    });
  }

  if (state.planState) {
    messages.push({
      role: "system",
      content: `Plan state: ${state.planState}`,
    });
  }

  if (state.mcpTools && state.mcpTools.length > 0) {
    messages.push({
      role: "system",
      content: `Available MCP tools: ${state.mcpTools.join(", ")}`,
    });
  }

  if (state.toolDeclarations && Object.keys(state.toolDeclarations).length > 0) {
    const toolNames = Object.keys(state.toolDeclarations).join(", ");
    messages.push({
      role: "system",
      content: `Available tools: ${toolNames}`,
    });
  }

  return messages;
}
