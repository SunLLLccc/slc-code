// Auto Memory Lifecycle — post-conversation auto-memory extraction and writing
// Extracted from app.tsx for testability

import { homedir } from "node:os";
import { join } from "node:path";
import { extractMemories } from "./auto-memory.js";
import { writeAutoMemories } from "./auto-memory-store.js";

export interface AutoMemoryOptions {
  /** Whether persistence is enabled (SessionManager.isEnabled) */
  persistenceEnabled: boolean;
  /** Whether auto memory extraction is enabled (memory.autoMemoryEnabled) */
  autoMemoryEnabled: boolean;
  /** cleanupPeriodDays from session config */
  cleanupPeriodDays: number;
  /** Project working directory */
  cwd: string;
  /** Explicit memoryDir override from config */
  memoryDir?: string;
  /** User config directory (default ~/.slc) — used as default memory write path */
  userConfigDir?: string;
}

/**
 * Extract and persist auto-memories from a conversation exchange.
 * Returns the number of memories written (0 if disabled or no patterns found).
 *
 * Write conditions (all must be true):
 * - persistenceEnabled (not bare mode, not persistenceEnabled=false)
 * - autoMemoryEnabled (memory.autoMemoryEnabled !== false)
 * - cleanupPeriodDays !== 0 (not "immediate cleanup" mode)
 *
 * Memory directory priority:
 * 1. Explicit config.memoryDir
 * 2. User config dir ~/.slc/memory (same path used by prompt assembly for reading)
 */
export async function processAutoMemory(
  userMessage: string,
  assistantResponse: string,
  options: AutoMemoryOptions,
): Promise<number> {
  // Check all disable conditions
  if (!options.persistenceEnabled) return 0;
  if (!options.autoMemoryEnabled) return 0;
  if (options.cleanupPeriodDays === 0) return 0;

  // Extract memories from user message only (NOT assistant response)
  // This prevents matching patterns like "记住" or "以后" in the model's own text
  const memories = extractMemories(userMessage);
  if (memories.length === 0) return 0;

  // Resolve memory directory: config.memoryDir > ~/.slc/memory (aligned with read path)
  const configDir = options.userConfigDir ?? join(homedir(), ".slc");
  const memoryDir = options.memoryDir ?? join(configDir, "memory");

  return writeAutoMemories(memoryDir, memories, { enabled: true });
}
