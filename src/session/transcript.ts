// Append-only JSONL transcript writer for session persistence

import { mkdir, appendFile, readFile, chmod, stat } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TranscriptEventType = "user" | "assistant" | "attachment" | "system";

/** Allowed transcript event types — PRD 14.1 */
const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  "user",
  "assistant",
  "attachment",
  "system",
]);

export interface TranscriptEvent {
  uuid: string;
  type: TranscriptEventType;
  timestamp: string; // ISO 8601
  content: string;
  metadata?: Record<string, unknown>;
}

export interface TranscriptWriterOptions {
  /** Session directory path (e.g. ~/.slc/sessions/<sessionId>) */
  sessionDir: string;
  /** Whether persistence is enabled (--bare disables) */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------

/**
 * Runtime check: is this a valid transcript event type?
 * Rejects tool_result, tool_call, and other non-transcript types.
 */
export function isTranscriptEventType(type: unknown): type is TranscriptEventType {
  return typeof type === "string" && ALLOWED_TYPES.has(type);
}

// ---------------------------------------------------------------------------
// TranscriptWriter
// ---------------------------------------------------------------------------

export class TranscriptWriter {
  private readonly sessionDir: string;
  private readonly enabled: boolean;
  private closed = false;
  private readonly writtenUuids = new Set<string>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: TranscriptWriterOptions) {
    this.sessionDir = options.sessionDir;
    this.enabled = options.enabled;
  }

  /**
   * Ensure the session directory exists with 0700 permissions.
   * Load existing UUIDs from transcript.jsonl for persistent dedup.
   */
  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.initPromise = (async () => {
      try {
        await mkdir(this.sessionDir, { recursive: true, mode: 0o700 });
      } catch {
        // Directory creation failed — writer will be effectively disabled
      }
      // Ensure directory permissions even if it already existed
      try { await chmod(this.sessionDir, 0o700); } catch { /* best-effort */ }
      // Load existing UUIDs for persistent dedup (must run even if dir existed)
      await this.loadExistingUuids();
      this.initialized = true;
    })();
    await this.initPromise;
  }

  /**
   * Load UUIDs from existing transcript.jsonl for dedup across writer restarts.
   */
  private async loadExistingUuids(): Promise<void> {
    try {
      const filePath = join(this.sessionDir, "transcript.jsonl");
      const content = await readFile(filePath, "utf-8");
      for (const line of content.split("\n")) {
        if (!line || line.trim() === "") continue;
        try {
          const parsed = JSON.parse(line) as TranscriptEvent;
          if (parsed.uuid) {
            this.writtenUuids.add(parsed.uuid);
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // File doesn't exist yet — that's fine
    }
  }

  /**
   * Append a transcript event to the JSONL file.
   * - Validates event.type at runtime (only user/assistant/attachment/system)
   * - Deduplicates by uuid (persistent across writer restarts)
   * - Ensures file permissions 0600
   */
  async append(event: TranscriptEvent): Promise<void> {
    if (!this.enabled || this.closed) return;

    // Runtime type validation — PRD 14.1
    if (!isTranscriptEventType(event.type)) {
      return; // Silently reject non-transcript types
    }

    // ensureDir loads existing UUIDs for persistent dedup
    await this.ensureDir();

    // Check dedup AFTER ensureDir so we pick up UUIDs from prior writers
    if (this.writtenUuids.has(event.uuid)) return;

    const line = JSON.stringify(event) + "\n";
    const filePath = join(this.sessionDir, "transcript.jsonl");

    try {
      await appendFile(filePath, line, { mode: 0o600 });
      // Ensure file permissions even if it already existed
      try { await chmod(filePath, 0o600); } catch { /* best-effort */ }
      this.writtenUuids.add(event.uuid);
    } catch {
      // Write failed silently — transcript is best-effort
    }
  }

  /**
   * Flush buffered writes. Currently write-through; buffer is reserved for
   * future batching.
   */
  flush(): void {
    // No-op: writes go through immediately via appendFile
  }

  /**
   * Flush and mark writer as closed. Subsequent append calls are no-ops.
   */
  close(): void {
    this.flush();
    this.closed = true;
  }

  /**
   * Returns the session directory path.
   */
  getSessionPath(): string {
    return this.sessionDir;
  }

  /**
   * Returns whether persistence is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// ---------------------------------------------------------------------------
// Sidechain Writer — for subagent transcripts (PRD 14.1)
// ---------------------------------------------------------------------------

/**
 * Create a sidechain transcript writer for a subagent.
 * Writes to a separate file (sidechain-<subagentId>.jsonl) in the same session dir.
 * Sidechain events never appear in the main transcript.jsonl.
 */
export function createSidechainWriter(
  sessionDir: string,
  subagentId: string,
  enabled: boolean = true,
): TranscriptWriter {
  // Sidechain uses the same session dir but a different filename
  // We achieve this by wrapping a TranscriptWriter with a custom path
  const sidechainDir = join(sessionDir, `sidechain-${subagentId}`);
  return new TranscriptWriter({ sessionDir: sidechainDir, enabled });
}
