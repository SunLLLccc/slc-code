// Session runtime helpers — wire resume/rewind to QueryEngine and SessionManager

import { homedir } from "node:os";
import { join } from "node:path";
import type { QueryEngine } from "../engine/engine.js";
import type { SessionManager } from "./session-manager.js";
import {
  loadTranscript,
  getAvailableSessions,
  rebuildSessionState,
} from "../session/resume.js";

const DEFAULT_SESSIONS_BASE = join(homedir(), ".slc", "sessions");

/**
 * Create a resumeSession callback for CommandContext.
 * Loads transcript, rebuilds ProviderMessages, loads into QueryEngine,
 * AND updates SessionManager to track the resumed session as current.
 */
export function createResumeSession(
  engine: QueryEngine,
  sessionManager: SessionManager,
  sessionsBase: string = DEFAULT_SESSIONS_BASE,
): (sessionDir: string) => Promise<boolean> {
  return async (sessionDir: string): Promise<boolean> => {
    const result = await loadTranscript(sessionDir);
    if (!result.success || result.events.length === 0) {
      return false;
    }
    const messages = rebuildSessionState(result.events);
    engine.loadMessages(messages);
    // Update SessionManager to track resumed session as current
    sessionManager.switchSession(sessionDir);
    return true;
  };
}

/**
 * Create a rewindToEvent callback for CommandContext.
 * Uses SessionManager's current sessionDir (not "most recent session").
 */
export function createRewindToEvent(
  engine: QueryEngine,
  sessionManager: SessionManager,
  sessionsBase: string = DEFAULT_SESSIONS_BASE,
): (uuid: string) => Promise<boolean> {
  return async (uuid: string): Promise<boolean> => {
    // Use current session from SessionManager, not "most recent"
    const targetDir = sessionManager.sessionDir;
    if (!targetDir) return false;

    const result = await loadTranscript(targetDir);
    if (!result.success) return false;

    const idx = result.events.findIndex((e) => e.uuid === uuid);
    if (idx === -1) return false;

    // Keep events up to and including the target
    const keptEvents = result.events.slice(0, idx + 1);
    const messages = rebuildSessionState(keptEvents);
    engine.replaceMessages(messages);
    return true;
  };
}
