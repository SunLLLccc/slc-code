// Append-only JSONL transcript writer for session persistence

import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TranscriptEventType = "user" | "assistant" | "attachment" | "system";

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
   * Ensure the session directory exists. Called lazily on first append.
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
      this.initialized = true;
    })();
    await this.initPromise;
  }

  /**
   * Append a transcript event to the JSONL file.
   * Deduplicates by uuid (skips if already written).
   */
  async append(event: TranscriptEvent): Promise<void> {
    if (!this.enabled || this.closed) return;
    if (this.writtenUuids.has(event.uuid)) return;

    await this.ensureDir();

    const line = JSON.stringify(event) + "\n";
    const filePath = join(this.sessionDir, "transcript.jsonl");

    try {
      await appendFile(filePath, line, { mode: 0o600 });
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
