// SessionManager — manages current session lifecycle in the REPL
// Creates TranscriptWriter, writes user/assistant events, tracks current sessionDir

import { homedir } from "node:os";
import { join } from "node:path";
import { TranscriptWriter, type TranscriptEvent } from "../session/transcript.js";

const DEFAULT_SESSIONS_BASE = join(homedir(), ".slc", "sessions");

export interface SessionManagerOptions {
  sessionsBase?: string;
  enabled?: boolean; // false for --bare mode
}

export class SessionManager {
  private readonly sessionsBase: string;
  private readonly enabled: boolean;
  private writer: TranscriptWriter | null = null;
  private _sessionDir: string | null = null;
  private _sessionId: string | null = null;

  constructor(options?: SessionManagerOptions) {
    this.sessionsBase = options?.sessionsBase ?? DEFAULT_SESSIONS_BASE;
    this.enabled = options?.enabled ?? true;
  }

  /**
   * Initialize a new session. Creates session dir and TranscriptWriter.
   * Called once at REPL startup.
   */
  initSession(): void {
    if (!this.enabled) return;

    this._sessionId = new Date().toISOString().replace(/[:.]/g, "-");
    this._sessionDir = join(this.sessionsBase, this._sessionId);
    this.writer = new TranscriptWriter({
      sessionDir: this._sessionDir,
      enabled: true,
    });
  }

  /**
   * Switch to an existing session (e.g. after /resume).
   * Creates a new writer pointing to the resumed session dir.
   */
  switchSession(sessionDir: string): void {
    this._sessionDir = sessionDir;
    // Extract sessionId from dir name
    this._sessionId = sessionDir.split("/").pop() ?? sessionDir;
    this.writer = new TranscriptWriter({
      sessionDir,
      enabled: true,
    });
  }

  /**
   * Append a user event to the transcript.
   */
  async appendUserEvent(content: string): Promise<void> {
    if (!this.writer) return;
    const event: TranscriptEvent = {
      uuid: `user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: "user",
      timestamp: new Date().toISOString(),
      content,
    };
    await this.writer.append(event);
  }

  /**
   * Append an assistant event to the transcript.
   */
  async appendAssistantEvent(content: string): Promise<void> {
    if (!this.writer) return;
    const event: TranscriptEvent = {
      uuid: `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: "assistant",
      timestamp: new Date().toISOString(),
      content,
    };
    await this.writer.append(event);
  }

  /**
   * Append a system event to the transcript.
   */
  async appendSystemEvent(content: string): Promise<void> {
    if (!this.writer) return;
    const event: TranscriptEvent = {
      uuid: `system-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: "system",
      timestamp: new Date().toISOString(),
      content,
    };
    await this.writer.append(event);
  }

  /** Current session directory path */
  get sessionDir(): string | null {
    return this._sessionDir;
  }

  /** Current session ID */
  get sessionId(): string | null {
    return this._sessionId;
  }

  /** Whether persistence is enabled */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Close the current writer */
  close(): void {
    this.writer?.close();
    this.writer = null;
  }
}
