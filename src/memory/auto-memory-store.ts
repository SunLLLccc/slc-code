// Auto Memory Store — writes extracted memories to allowed memory directory
// Path-restricted: can only write to configured memoryDir

import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import type { MemoryEntry } from "./recall.js";

const MEMORY_FILE_MODE = 0o600;

/**
 * Write auto-extracted memories to the memory directory.
 * Each memory becomes a separate .md file with frontmatter.
 * Returns the number of memories written.
 *
 * Security: only writes to memoryDir, rejects path traversal.
 */
export async function writeAutoMemories(
  memoryDir: string,
  entries: MemoryEntry[],
  options?: { enabled?: boolean },
): Promise<number> {
  if (options?.enabled === false) return 0;
  if (entries.length === 0) return 0;

  // Security: ensure memoryDir is resolved
  const resolvedDir = resolve(memoryDir);
  await mkdir(resolvedDir, { recursive: true, mode: 0o700 });

  let written = 0;
  for (const entry of entries) {
    const filename = `${entry.name}.md`;
    const filePath = join(resolvedDir, filename);
    const resolvedPath = resolve(filePath);

    // Security: path must be within memoryDir
    const rel = relative(resolvedDir, resolvedPath);
    if (rel.startsWith("..") || rel.startsWith("/")) {
      continue; // Skip path traversal attempts
    }

    const content = formatMemoryFile(entry);
    try {
      await writeFile(filePath, content, { mode: MEMORY_FILE_MODE });
      written++;
    } catch {
      // Best-effort: skip files we can't write
    }
  }

  return written;
}

/**
 * Format a MemoryEntry as a markdown file with YAML frontmatter.
 */
function formatMemoryFile(entry: MemoryEntry): string {
  return `---
name: ${entry.name}
description: ${entry.description}
metadata:
  type: ${entry.metadata.type}
---

${entry.content}
`;
}
