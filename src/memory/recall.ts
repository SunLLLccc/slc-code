import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface MemoryEntry {
  name: string;
  description: string;
  content: string;
  metadata: { type: "user" | "feedback" | "project" | "reference" };
}

export const MEMORY_MAX_LINES = 200;
export const MEMORY_MAX_BYTES = 25 * 1024;

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns null if the frontmatter is missing or malformed.
 */
function parseFrontmatter(text: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} | null {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const raw = match[1];
  const body = match[2];

  // Simple key-value parser for flat and nested keys
  const frontmatter: Record<string, unknown> = {};
  let currentSection: Record<string, string> | null = null;
  let currentKey = "";

  for (const line of raw.split("\n")) {
    // Nested section like "metadata:"
    const sectionMatch = line.match(/^(\w+):\s*$/);
    if (sectionMatch) {
      currentKey = sectionMatch[1];
      currentSection = {};
      frontmatter[currentKey] = currentSection;
      continue;
    }

    // Nested key like "  type: user"
    const nestedMatch = line.match(/^\s+(\w+):\s*(.+)$/);
    if (nestedMatch && currentSection) {
      currentSection[nestedMatch[1]] = nestedMatch[2].trim();
      continue;
    }

    // Top-level key like "name: foo"
    const topMatch = line.match(/^(\w+):\s*(.+)$/);
    if (topMatch) {
      currentSection = null;
      frontmatter[topMatch[1]] = topMatch[2].trim();
    }
  }

  return { frontmatter, body };
}

/**
 * Load all memory entries from .md files in the given directory.
 */
export async function loadMemories(
  memoryDir: string,
): Promise<MemoryEntry[]> {
  let files: string[];
  try {
    files = await readdir(memoryDir);
  } catch {
    return [];
  }

  const entries: MemoryEntry[] = [];

  for (const file of files.sort()) {
    if (!file.endsWith(".md")) continue;

    const text = await readFile(join(memoryDir, file), "utf-8");
    const parsed = parseFrontmatter(text);
    if (!parsed) continue;

    const { frontmatter, body } = parsed;
    const name = frontmatter.name ?? file.replace(/\.md$/, "");
    const description =
      typeof frontmatter.description === "string"
        ? frontmatter.description
        : "";
    const metadataObj =
      frontmatter.metadata &&
      typeof frontmatter.metadata === "object" &&
      !Array.isArray(frontmatter.metadata)
        ? (frontmatter.metadata as Record<string, string>)
        : {};
    const type = metadataObj.type;

    const validTypes = ["user", "feedback", "project", "reference"] as const;
    const entryType = (
      validTypes as readonly string[]
    ).includes(type)
      ? (type as MemoryEntry["metadata"]["type"])
      : "reference";

    entries.push({
      name: String(name),
      description,
      content: body.trim(),
      metadata: { type: entryType },
    });
  }

  return entries;
}

/**
 * Format memories as markdown for inclusion in a prompt.
 * Respects MEMORY_MAX_LINES and MEMORY_MAX_BYTES limits.
 */
export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return "";

  const lines: string[] = [];
  let totalBytes = 0;

  for (const mem of memories) {
    const block = [
      `### ${mem.name}`,
      mem.description ? `_${mem.description}_` : "",
      mem.content,
    ]
      .filter(Boolean)
      .join("\n");

    const blockLines = block.split("\n");

    // Check limits before adding
    if (lines.length + blockLines.length > MEMORY_MAX_LINES) break;
    if (totalBytes + block.length + 1 > MEMORY_MAX_BYTES) break;

    lines.push(block);
    totalBytes += block.length + 1; // +1 for separator newline
  }

  return lines.join("\n\n");
}
