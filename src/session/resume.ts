// Resume loading — read and query session transcripts

import { readFile, readdir, stat, open } from "node:fs/promises";
import { join } from "node:path";
import type { TranscriptEvent } from "./transcript.js";
import { isTranscriptEventType } from "./transcript.js";

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
// Lite reader constants — PRD 14.4
// ---------------------------------------------------------------------------

const LITE_WINDOW_BYTES = 64 * 1024; // 64KB head/tail window

// ---------------------------------------------------------------------------
// loadTranscript — full read (for resume)
// ---------------------------------------------------------------------------

/**
 * Read transcript.jsonl from a session directory and parse each line.
 * Returns an empty events array for missing or empty files.
 * Malformed lines are skipped with a console warning.
 * Only events with valid transcript types are included.
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

  return parseTranscriptContent(content, filePath);
}

// ---------------------------------------------------------------------------
// Lite metadata reader — PRD 14.4 (head/tail 64KB only)
// ---------------------------------------------------------------------------

/**
 * Read only the head and tail of transcript.jsonl (64KB each) for metadata.
 * Does NOT read the entire file — suitable for /session listing.
 */
export async function getSessionMetadataLite(
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

  const fileSize = fileStat.size;

  if (fileSize === 0) {
    return { title: "Empty session", eventCount: 0, lastModified: fileStat.mtime.toISOString() };
  }

  // For small files, just read everything
  if (fileSize <= LITE_WINDOW_BYTES * 2) {
    const result = await loadTranscript(sessionDir);
    if (!result.success) return null;
    return extractMetadata(result.events, fileStat.mtime.toISOString());
  }

  // Read head window
  const headEvents = await readWindow(filePath, 0, LITE_WINDOW_BYTES);

  // Read tail window
  const tailStart = Math.max(0, fileSize - LITE_WINDOW_BYTES);
  const tailEvents = await readWindow(filePath, tailStart, LITE_WINDOW_BYTES);

  // Title from head, event count estimated from tail UUID (rough count)
  let title = "Untitled session";
  for (const event of headEvents) {
    if (event.type === "user" && event.content) {
      title = event.content.length > 120
        ? event.content.slice(0, 120) + "..."
        : event.content;
      break;
    }
  }

  // Estimate event count from total file size and average event size
  const sampleEvents = [...headEvents, ...tailEvents];
  const avgEventSize = sampleEvents.length > 0
    ? sampleEvents.reduce((sum, e) => sum + JSON.stringify(e).length + 1, 0) / sampleEvents.length
    : 200;
  const estimatedCount = Math.max(1, Math.round(fileSize / avgEventSize));

  return {
    title,
    eventCount: estimatedCount,
    lastModified: fileStat.mtime.toISOString(),
  };
}

/**
 * Read a window of bytes from a file and parse JSONL events from it.
 * Discards first and last lines if they may be incomplete (window boundaries).
 */
async function readWindow(
  filePath: string,
  offset: number,
  length: number,
): Promise<TranscriptEvent[]> {
  try {
    const fh = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buffer, 0, length, offset);
      const content = buffer.subarray(0, bytesRead).toString("utf-8");
      const lines = content.split("\n");

      // Discard first line if we're not at the start (may be incomplete)
      const start = offset > 0 ? 1 : 0;
      // Discard last line if the window doesn't end at a newline (may be incomplete)
      const end = content.endsWith("\n") ? lines.length : lines.length - 1;

      const trimmed = lines.slice(start, end).join("\n");
      return parseTranscriptContent(trimmed, filePath).events;
    } finally {
      await fh.close();
    }
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// getSessionMetadata — full metadata (uses loadTranscript)
// ---------------------------------------------------------------------------

/**
 * Read metadata from a session directory using full transcript read.
 * For /session listing, prefer getSessionMetadataLite instead.
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

  return extractMetadata(result.events, fileStat.mtime.toISOString());
}

// ---------------------------------------------------------------------------
// rebuildSessionState — convert transcript events to ProviderMessages
// ---------------------------------------------------------------------------

import type { ProviderMessage } from "../engine/types.js";

/**
 * Rebuild ProviderMessage[] from transcript events for resume.
 * Filters to only user/assistant/system events and converts to engine format.
 */
export function rebuildSessionState(events: TranscriptEvent[]): ProviderMessage[] {
  const messages: ProviderMessage[] = [];

  for (const event of events) {
    // Skip non-transcript types (shouldn't be in file, but defensive)
    if (!isTranscriptEventType(event.type)) continue;

    switch (event.type) {
      case "system":
        messages.push({ role: "system", content: event.content });
        break;
      case "user":
        messages.push({ role: "user", content: event.content });
        break;
      case "assistant":
        messages.push({ role: "assistant", content: event.content });
        break;
      case "attachment":
        // Attachments become user messages with context
        messages.push({ role: "user", content: `[Attachment]: ${event.content}` });
        break;
    }
  }

  return messages;
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
// Helpers
// ---------------------------------------------------------------------------

function extractMetadata(events: TranscriptEvent[], lastModified: string): SessionMetadata {
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
    lastModified,
  };
}

function parseTranscriptContent(content: string, filePath: string): ResumeResult {
  const lines = content.split("\n");
  const events: TranscriptEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === "") continue;

    try {
      const parsed = JSON.parse(line) as TranscriptEvent;
      // Runtime type validation — only allow transcript event types
      if (!isTranscriptEventType(parsed.type)) {
        continue; // Skip non-transcript types silently
      }
      events.push(parsed);
    } catch {
      console.warn(`Skipping malformed transcript line ${i + 1} in ${filePath}`);
    }
  }

  return { success: true, events };
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
