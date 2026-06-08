// Session runtime helpers — wire resume/rewind to QueryEngine

import { homedir } from "node:os";
import { join } from "node:path";
import type { QueryEngine } from "../engine/engine.js";
import {
  loadTranscript,
  getAvailableSessions,
  rebuildSessionState,
} from "../session/resume.js";

const DEFAULT_SESSIONS_BASE = join(homedir(), ".slc", "sessions");

/**
 * Create a resumeSession callback for CommandContext.
 * Loads transcript from sessionDir, rebuilds ProviderMessages, and loads into QueryEngine.
 */
export function createResumeSession(
  engine: QueryEngine,
  sessionsBase: string = DEFAULT_SESSIONS_BASE,
): (sessionDir: string) => Promise<boolean> {
  return async (sessionDir: string): Promise<boolean> => {
    const result = await loadTranscript(sessionDir);
    if (!result.success || result.events.length === 0) {
      return false;
    }
    const messages = rebuildSessionState(result.events);
    engine.loadMessages(messages);
    return true;
  };
}

/**
 * Create a rewindToEvent callback for CommandContext.
 * Loads transcript, finds the target UUID, truncates messages up to that point.
 */
export function createRewindToEvent(
  engine: QueryEngine,
  sessionDir: string | undefined,
  sessionsBase: string = DEFAULT_SESSIONS_BASE,
): (uuid: string) => Promise<boolean> {
  return async (uuid: string): Promise<boolean> => {
    // Determine which session to rewind
    const targetDir = sessionDir ?? await findMostRecentSession(sessionsBase);
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

async function findMostRecentSession(sessionsBase: string): Promise<string | null> {
  const sessions = await getAvailableSessions(sessionsBase);
  if (sessions.length === 0) return null;
  return join(sessionsBase, sessions[0]!);
}
