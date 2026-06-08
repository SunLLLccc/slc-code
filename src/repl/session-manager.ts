// SessionManager — manages current session lifecycle in the REPL
// Creates TranscriptWriter, writes user/assistant events, tracks current sessionDir
// Handles cleanup and persistence modes (bare, cleanupPeriodDays=0)

import { homedir } from "node:os";
import { join } from "node:path";
import { TranscriptWriter, type TranscriptEvent } from "../session/transcript.js";
import { cleanupSessions } from "../session/cleanup.js";

const DEFAULT_SESSIONS_BASE = join(homedir(), ".slc", "sessions");

export interface SessionManagerOptions {
  sessionsBase?: string;
  enabled?: boolean; // false for --bare mode
  cleanupPeriodDays?: number; // default 30; 0 = delete all + no current writer
}

export class SessionManager {
  private readonly sessionsBase: string;
  private readonly enabled: boolean;
  private _writable = false; // false when bare mode or cleanupPeriodDays=0
  private writer: TranscriptWriter | null = null;
  private _sessionDir: string | null = null;
  private _sessionId: string | null = null;
  private _initialized = false;

  constructor(options?: SessionManagerOptions) {
    this.sessionsBase = options?.sessionsBase ?? DEFAULT_SESSIONS_BASE;
    this.enabled = options?.enabled ?? true;
  }

  /**
   * Initialize session lifecycle in correct order:
   * 1. Cleanup expired sessions (awaited, not fire-and-forget)
   * 2. If cleanupPeriodDays=0 or enabled=false → no writer (bare-like)
   * 3. Otherwise create session dir and writer
   *
   * Must be called once at REPL startup. Idempotent.
   */
  async cleanupAndInit(cleanupPeriodDays: number = 30): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;

    // Step 1: Cleanup expired sessions (awaited)
    if (this.enabled) {
      await cleanupSessions({
        sessionsBase: this.sessionsBase,
        cleanupPeriodDays,
      });
    }

    // Step 2: If cleanupPeriodDays=0 or bare mode → no writer for current session
    if (!this.enabled || cleanupPeriodDays === 0) {
      return; // No session, no writer
    }

    // Step 3: Create new session with writer
    this._writable = true;
    this._sessionId = new Date().toISOString().replace(/[:.]/g, "-");
    this._sessionDir = join(this.sessionsBase, this._sessionId);
    this.writer = new TranscriptWriter({
      sessionDir: this._sessionDir,
      enabled: true,
    });
  }

  /**
   * Switch to an existing session (e.g. after /resume).
   * If not writable (bare mode or cleanupPeriodDays=0), only updates runtime state.
   */
  switchSession(sessionDir: string): void {
    this._sessionDir = sessionDir;
    this._sessionId = sessionDir.split("/").pop() ?? sessionDir;
    if (!this._writable) return; // bare mode or cleanupPeriodDays=0: no writer
    this.writer = new TranscriptWriter({
      sessionDir,
      enabled: true,
    });
  }

  /**
   * Append a user event to the transcript.
   * No-op if writer is null (bare mode, cleanupPeriodDays=0, or not initialized).
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

  /** Whether the manager has been initialized */
  get isInitialized(): boolean {
    return this._initialized;
  }

  /** Close the current writer */
  close(): void {
    this.writer?.close();
    this.writer = null;
  }
}
