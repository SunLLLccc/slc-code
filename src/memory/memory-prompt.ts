// Memory prompt — loads memory extraction template and builds instructions

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_MEMORY_PROMPT_PATH = join(
  process.cwd(),
  "resources",
  "prompts",
  "memory.md",
);

/**
 * Load the memory extraction prompt template.
 * Falls back to a minimal default if the file can't be read.
 */
export async function loadMemoryPrompt(): Promise<string> {
  try {
    return await readFile(DEFAULT_MEMORY_PROMPT_PATH, "utf-8");
  } catch {
    return getDefaultMemoryPrompt();
  }
}

/**
 * Build memory extraction instructions for the model.
 */
export function buildMemoryExtractionPrompt(conversation: string): string {
  return `Extract user preferences, project conventions, and feedback from this conversation.
Only extract durable facts, not transient conversation details.
Format each memory as a markdown file with YAML frontmatter.

Conversation:
${conversation}`;
}

/**
 * Build session memory update instructions.
 */
export function buildSessionMemoryUpdatePrompt(
  existingMemory: string,
  newContent: string,
): string {
  if (!existingMemory) {
    return `Create a session memory file summarizing this session's key context.
Include: current task, files being worked on, decisions made, important findings.

New content:
${newContent}`;
  }

  return `Update the existing session memory with new information.
Preserve existing context that's still relevant. Remove outdated information.

Existing memory:
${existingMemory}

New content:
${newContent}`;
}

function getDefaultMemoryPrompt(): string {
  return `Extract memories from the conversation. Each memory should be a markdown file with YAML frontmatter:

---
name: <short-kebab-case-slug>
description: <one-line summary>
metadata:
  type: user | feedback | project | reference
---

<the fact>

Only extract durable facts like user preferences, project conventions, and feedback.`;
}
