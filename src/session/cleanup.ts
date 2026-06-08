// Session cleanup — remove expired sessions based on cleanupPeriodDays

import { readdir, stat, rm } from "node:fs/promises";
import { join } from "node:path";

export interface CleanupOptions {
  /** Base directory containing session folders */
  sessionsBase: string;
  /**
   * Number of days to keep sessions.
   * 0 = delete all sessions immediately.
   * -1 = never delete (no cleanup).
   */
  cleanupPeriodDays: number;
}

export interface CleanupResult {
  /** Number of sessions deleted */
  deleted: number;
  /** Number of sessions kept */
  kept: number;
  /** Errors encountered during cleanup */
  errors: string[];
}

/**
 * Clean up expired sessions based on cleanupPeriodDays.
 * - cleanupPeriodDays = 0: delete all sessions
 * - cleanupPeriodDays > 0: delete sessions older than N days
 * - cleanupPeriodDays < 0: no cleanup
 */
export async function cleanupSessions(options: CleanupOptions): Promise<CleanupResult> {
  const { sessionsBase, cleanupPeriodDays } = options;
  const result: CleanupResult = { deleted: 0, kept: 0, errors: [] };

  // No cleanup
  if (cleanupPeriodDays < 0) return result;

  let entries: string[];
  try {
    const dirents = await readdir(sessionsBase, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return result; // No sessions dir yet
    }
    result.errors.push(`Failed to read sessions directory: ${err}`);
    return result;
  }

  const cutoffMs = cleanupPeriodDays === 0
    ? Infinity // Delete everything
    : Date.now() - cleanupPeriodDays * 24 * 60 * 60 * 1000;

  for (const name of entries) {
    const sessionDir = join(sessionsBase, name);
    try {
      const sessionStat = await stat(sessionDir);
      if (sessionStat.mtimeMs < cutoffMs) {
        await rm(sessionDir, { recursive: true, force: true });
        result.deleted++;
      } else {
        result.kept++;
      }
    } catch (err) {
      result.errors.push(`Failed to process ${name}: ${err}`);
    }
  }

  return result;
}
