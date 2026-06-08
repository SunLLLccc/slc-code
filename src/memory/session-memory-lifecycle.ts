// Session Memory Lifecycle — auto-creates session-memory.md when token threshold reached

import type { ProviderMessage } from "../engine/types.js";
import { writeSessionMemory } from "./session-memory.js";
import { extractMemories } from "./auto-memory.js";

const SESSION_MEMORY_TOKEN_THRESHOLD = 10000;
const CHARS_PER_TOKEN = 4;

/**
 * Get content from a ProviderMessage (handles all variants).
 */
function getMessageContent(m: ProviderMessage): string {
  if ("content" in m) return m.content ?? "";
  if ("result" in m) return m.result ?? "";
  return "";
}

/**
 * Check if session memory should be created/updated based on message volume.
 */
export function shouldCreateSessionMemory(messages: ProviderMessage[]): boolean {
  const totalChars = messages.reduce((sum, m) => sum + getMessageContent(m).length, 0);
  const estimatedTokens = totalChars / CHARS_PER_TOKEN;
  return estimatedTokens >= SESSION_MEMORY_TOKEN_THRESHOLD;
}

/**
 * Build session memory content from conversation messages.
 * Extracts key facts using heuristic patterns.
 */
export function buildSessionMemoryContent(messages: ProviderMessage[]): string {
  // Extract conversation text
  const conversation = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role}: ${getMessageContent(m)}`)
    .join("\n");

  // Use auto-memory extraction
  const memories = extractMemories(conversation);

  if (memories.length === 0) {
    // Fallback: summarize recent messages
    const recent = messages.slice(-5);
    return `# Session Memory\n\nRecent conversation:\n${recent.map((m) => `- ${m.role}: ${getMessageContent(m).slice(0, 100)}`).join("\n")}`;
  }

  const entries = memories.map((m) => `- ${m.description}: ${m.content}`).join("\n");
  return `# Session Memory\n\n${entries}`;
}

/**
 * Persist session memory if conditions are met.
 * Returns true if memory was written.
 */
export async function persistSessionMemory(
  messages: ProviderMessage[],
  sessionDir: string | null,
  persistenceEnabled: boolean,
): Promise<boolean> {
  if (!sessionDir || !persistenceEnabled) return false;
  if (!shouldCreateSessionMemory(messages)) return false;

  const content = buildSessionMemoryContent(messages);
  return writeSessionMemory(sessionDir, content, true);
}
