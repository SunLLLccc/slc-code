// Session Memory — creates/updates session-memory.md in sessionDir
// Writes only when persistence is enabled; path-restricted to sessionDir

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { existsSync } from "node:fs";

const SESSION_MEMORY_FILENAME = "session-memory.md";
const SESSION_MEMORY_MAX_BYTES = 10 * 1024; // 10KB limit for session memory

/**
 * Load existing session memory from sessionDir.
 * Returns empty string if not found.
 */
export async function loadSessionMemory(sessionDir: string): Promise<string> {
  const filePath = join(sessionDir, SESSION_MEMORY_FILENAME);
  try {
    const content = await readFile(filePath, "utf-8");
    return content.length > SESSION_MEMORY_MAX_BYTES
      ? content.slice(0, SESSION_MEMORY_MAX_BYTES)
      : content;
  } catch {
    return "";
  }
}

/**
 * Write session memory to sessionDir.
 * Path must be within sessionDir (security check).
 * No-op if persistenceEnabled is false.
 */
export async function writeSessionMemory(
  sessionDir: string,
  content: string,
  persistenceEnabled: boolean = true,
): Promise<boolean> {
  if (!persistenceEnabled) return false;

  const filePath = join(sessionDir, SESSION_MEMORY_FILENAME);
  const resolvedPath = resolve(filePath);
  const resolvedDir = resolve(sessionDir);

  // Security: path must be within sessionDir
  const rel = relative(resolvedDir, resolvedPath);
  if (rel.startsWith("..") || rel.startsWith("/")) {
    return false; // Path traversal attempt
  }

  try {
    await mkdir(sessionDir, { recursive: true });
    const truncated = content.length > SESSION_MEMORY_MAX_BYTES
      ? content.slice(0, SESSION_MEMORY_MAX_BYTES)
      : content;
    await writeFile(filePath, truncated, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if session memory exists in sessionDir.
 */
export function hasSessionMemory(sessionDir: string): boolean {
  return existsSync(join(sessionDir, SESSION_MEMORY_FILENAME));
}
