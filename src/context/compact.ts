// Compact — simple heuristic conversation compaction

import type { ProviderMessage } from "../engine/types.js";

const KEEP_LAST = 10;

/**
 * Compact a conversation history:
 * - System messages are kept as-is.
 * - The last KEEP_LAST non-system messages are kept.
 * - Older non-system messages are replaced with a single summary placeholder.
 */
export function compactMessages(messages: ProviderMessage[]): ProviderMessage[] {
  const systemMessages: ProviderMessage[] = [];
  const nonSystemMessages: ProviderMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemMessages.push(msg);
    } else {
      nonSystemMessages.push(msg);
    }
  }

  if (nonSystemMessages.length <= KEEP_LAST) {
    return messages;
  }

  const olderCount = nonSystemMessages.length - KEEP_LAST;
  const kept = nonSystemMessages.slice(-KEEP_LAST);

  const summary: ProviderMessage = {
    role: "system",
    content: `[Compacted summary of ${olderCount} earlier messages]`,
  };

  return [...systemMessages, summary, ...kept];
}
