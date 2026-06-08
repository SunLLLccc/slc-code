// Resume loading — read and query session transcripts

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { TranscriptEvent } from "./transcript.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResumeResult {
  /** Whether resume succeeded */
  success: boolean;
  /** Loaded transcript events */
  events: TranscriptEvent[];
  /** Error message if failed */
  error?: string;
}

export interface SessionMetadata {
  title: string;
  eventCount: number;
  lastModified: string;
}

// ---------------------------------------------------------------------------
// loadTranscript
// ---------------------------------------------------------------------------

/**
 * Read transcript.jsonl from a session directory and parse each line.
 * Returns an empty events array for missing or empty files.
 * Malformed lines are skipped with a console warning.
 */
export async function loadTranscript(sessionDir: string): Promise<ResumeResult> {
  const filePath = join(sessionDir, "transcript.jsonl");

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err: unknown) {
    if (isEnoent(err)) {
      return { success: true, events: [] };
    }
    return {
      success: false,
      events: [],
      error: `Failed to read transcript: ${toErrorMessage(err)}`,
    };
  }

  if (content.trim() === "") {
    return { success: true, events: [] };
  }

  const lines = content.split("\n");
  const events: TranscriptEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === "") continue;

    try {
      const parsed = JSON.parse(line) as TranscriptEvent;
      events.push(parsed);
    } catch {
      console.warn(`Skipping malformed transcript line ${i + 1} in ${filePath}`);
    }
  }

  return { success: true, events };
}

// ---------------------------------------------------------------------------
// getAvailableSessions
// ---------------------------------------------------------------------------

/**
 * List session directories in the base sessions dir, sorted by modification
 * time (newest first). Each entry is the session directory name.
 */
export async function getAvailableSessions(baseDir: string): Promise<string[]> {
  let entries: string[];
  try {
    const dirents = await readdir(baseDir, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (err: unknown) {
    if (isEnoent(err)) return [];
    return [];
  }

  // Get modification times for sorting
  const withMtime: Array<{ name: string; mtime: number }> = [];
  for (const name of entries) {
    try {
      const s = await stat(join(baseDir, name));
      withMtime.push({ name, mtime: s.mtimeMs });
    } catch {
      // Skip entries we can't stat
    }
  }

  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.map((e) => e.name);
}

// ---------------------------------------------------------------------------
// getSessionMetadata
// ---------------------------------------------------------------------------

/**
 * Read metadata from a session directory:
 * - title: content of the first user event (truncated to 120 chars)
 * - eventCount: total number of events
 * - lastModified: ISO timestamp of the transcript file's last modification
 *
 * Returns null if the session doesn't exist or has no transcript.
 */
export async function getSessionMetadata(
  sessionDir: string,
): Promise<SessionMetadata | null> {
  const filePath = join(sessionDir, "transcript.jsonl");

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (err: unknown) {
    if (isEnoent(err)) return null;
    return null;
  }

  const result = await loadTranscript(sessionDir);
  if (!result.success) return null;

  const events = result.events;

  // Find first user event for title
  let title = "Untitled session";
  for (const event of events) {
    if (event.type === "user" && event.content) {
      title = event.content.length > 120
        ? event.content.slice(0, 120) + "..."
        : event.content;
      break;
    }
  }

  return {
    title,
    eventCount: events.length,
    lastModified: fileStat.mtime.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isEnoent(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
