// /rewind — rewind to a specific transcript event

import { homedir } from "node:os";
import { join } from "node:path";

import type { Command, CommandContext } from "../registry.js";
import { loadTranscript, getAvailableSessions, rebuildSessionState } from "../../session/resume.js";

const DEFAULT_SESSIONS_BASE = join(homedir(), ".slc", "sessions");

export const rewindCommand: Command = {
  name: "rewind",
  description: "Rewind to a specific transcript event",
  usage: "/rewind <event-uuid>",

  async execute(args: string, context: CommandContext): Promise<string> {
    const targetUuid = args.trim();

    if (!targetUuid) {
      return "Usage: /rewind <event-uuid>";
    }

    const sessionsBase = (context.config?.sessionsBase as string) ?? DEFAULT_SESSIONS_BASE;

    // Use current session from config, or fall back to most recent
    const sessionDir = (context.config?.sessionDir as string | undefined)
      ?? await findMostRecentSession(sessionsBase);

    if (!sessionDir) {
      return "No session found to rewind.";
    }

    const result = await loadTranscript(sessionDir);

    if (!result.success) {
      return `Failed to load transcript: ${result.error ?? "unknown error"}`;
    }

    const idx = result.events.findIndex((e) => e.uuid === targetUuid);

    if (idx === -1) {
      return `Event "${targetUuid}" not found in current session.`;
    }

    const kept = result.events.slice(0, idx + 1);
    const removed = result.events.length - kept.length;

    // Actually rewind: rebuild messages from kept events and load into QueryEngine
    const rewindCallback = context.rewindToEvent ?? (context.config?.rewindToEvent as ((uuid: string) => Promise<boolean>) | undefined);
    if (rewindCallback) {
      const success = await rewindCallback(targetUuid);
      if (!success) {
        return `Failed to rewind to event ${targetUuid}.`;
      }
    }

    return `Rewound to event ${targetUuid} (${idx + 1}/${result.events.length}).\n  Kept: ${kept.length} events\n  Removed: ${removed} events`;
  },
};

async function findMostRecentSession(sessionsBase: string): Promise<string | null> {
  const sessions = await getAvailableSessions(sessionsBase);
  if (sessions.length === 0) return null;
  return join(sessionsBase, sessions[0]!);
}
