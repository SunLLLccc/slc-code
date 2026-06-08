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
import { setAgentContext } from "../tools/builtin/agent.js";
import type { Provider } from "../engine/providers/base.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { PermissionChecker } from "../tools/scheduler.js";

const DEFAULT_SESSIONS_BASE = join(homedir(), ".slc", "sessions");

/**
 * Create a resumeSession callback for CommandContext.
 * Loads transcript, rebuilds ProviderMessages, loads into QueryEngine,
 * AND updates SessionManager + AgentTool sessionDir.
 */
export function createResumeSession(
  engine: QueryEngine,
  sessionManager: SessionManager,
  sessionsBase: string = DEFAULT_SESSIONS_BASE,
  options?: { provider?: Provider; toolRegistry?: ToolRegistry; permissionChecker?: PermissionChecker },
): (sessionDir: string) => Promise<boolean> {
  return async (sessionDir: string): Promise<boolean> => {
    const result = await loadTranscript(sessionDir);
    if (!result.success || result.events.length === 0) {
      return false;
    }
    const messages = rebuildSessionState(result.events);
    engine.loadMessages(messages);
    // Update SessionManager to track resumed session as current
    await sessionManager.switchSession(sessionDir);
    // Update AgentTool context — preserve parent toolRegistry and permissionChecker
    if (options?.provider) {
      setAgentContext({
        provider: options.provider,
        sessionDir,
        toolRegistry: options.toolRegistry,
        permissionChecker: options.permissionChecker,
      });
    }
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
