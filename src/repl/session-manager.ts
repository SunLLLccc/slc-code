// SessionManager — manages current session lifecycle in the REPL
// Creates TranscriptWriter, writes user/assistant events, tracks current sessionDir
// Handles cleanup and persistence modes (bare, cleanupPeriodDays=0)
// Guarantees: append operations wait for initialization to complete before writing

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
  private _writable = false;
  private writer: TranscriptWriter | null = null;
  private _sessionDir: string | null = null;
  private _sessionId: string | null = null;
  private _initialized = false;
  private _initPromise: Promise<void> | null = null;

  constructor(options?: SessionManagerOptions) {
    this.sessionsBase = options?.sessionsBase ?? DEFAULT_SESSIONS_BASE;
    this.enabled = options?.enabled ?? true;
  }

  /**
   * Start initialization lifecycle (non-blocking).
   * Returns immediately; use ensureInitialized() to wait.
   * Idempotent: second call is no-op.
   */
  cleanupAndInit(cleanupPeriodDays: number = 30): Promise<void> {
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      // Step 1: Cleanup expired sessions (awaited)
      if (this.enabled) {
        await cleanupSessions({
          sessionsBase: this.sessionsBase,
          cleanupPeriodDays,
        });
      }

      // Step 2: If cleanupPeriodDays=0 or bare mode → no writer for current session
      if (!this.enabled || cleanupPeriodDays === 0) {
        this._initialized = true;
        return;
      }

      // Step 3: Create new session with writer
      this._writable = true;
      this._sessionId = new Date().toISOString().replace(/[:.]/g, "-");
      this._sessionDir = join(this.sessionsBase, this._sessionId);
      this.writer = new TranscriptWriter({
        sessionDir: this._sessionDir,
        enabled: true,
      });
      this._initialized = true;
    })();

    return this._initPromise;
  }

  /**
   * Ensure initialization has completed before proceeding.
   * All append/switch operations call this to guarantee no race.
   */
  async ensureInitialized(): Promise<void> {
    if (this._initialized) return;
    if (this._initPromise) {
      await this._initPromise;
      return;
    }
    // If cleanupAndInit was never called, initialize with defaults
    await this.cleanupAndInit(30);
  }

  /**
   * Switch to an existing session (e.g. after /resume).
   * Waits for initialization first.
   */
  async switchSession(sessionDir: string): Promise<void> {
    await this.ensureInitialized();
    this._sessionDir = sessionDir;
    this._sessionId = sessionDir.split("/").pop() ?? sessionDir;
    if (!this._writable) return;
    this.writer = new TranscriptWriter({
      sessionDir,
      enabled: true,
    });
  }

  /**
   * Append a user event to the transcript.
   * Waits for initialization first — no race with cleanup.
   */
  async appendUserEvent(content: string): Promise<void> {
    await this.ensureInitialized();
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
   * Waits for initialization first.
   */
  async appendAssistantEvent(content: string): Promise<void> {
    await this.ensureInitialized();
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
   * Waits for initialization first.
   */
  async appendSystemEvent(content: string): Promise<void> {
    await this.ensureInitialized();
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

  /** Whether the session writer is active (cleanupPeriodDays=0 or bare → false) */
  get writable(): boolean {
    return this._writable;
  }

  /** Close the current writer */
  close(): void {
    this.writer?.close();
    this.writer = null;
  }
}
