// Prompt assembly — shared helper for building system prompt from rules + memory
// Used by REPL, executePrint, executeStdin, and any other entry point

import { homedir } from "node:os";
import { join } from "node:path";
import { buildSystemPrompt } from "./system-prompt.js";
import { loadRules } from "./rules-loader.js";
import { loadMemories, formatMemoriesForPrompt } from "../memory/recall.js";

export interface AssemblyOptions {
  /** Project root directory (for SLC.md / .slc/rules/) */
  cwd?: string;
  /** User config directory (default ~/.slc) */
  userConfigDir?: string;
  /** Skip loading rules/memory (for testing or --bare) */
  skip?: boolean;
}

/**
 * Build the runtime system prompt by loading rules and memory.
 * Shared across all entry points (REPL, --print, --stdin).
 */
export async function assembleSystemPrompt(
  options?: AssemblyOptions,
): Promise<string | undefined> {
  if (options?.skip) return undefined;

  const cwd = options?.cwd ?? process.cwd();
  const userConfigDir = options?.userConfigDir ?? join(homedir(), ".slc");

  try {
    const rules = await loadRules({ projectRoot: cwd, userConfigDir });
    const memories = await loadMemories(join(userConfigDir, "memory"));
    const memoryStr = formatMemoriesForPrompt(memories);
    return await buildSystemPrompt({ rules, memory: memoryStr });
  } catch {
    // Fallback: no rules/memory — return undefined so QueryEngine uses no system prompt
    return undefined;
  }
}
