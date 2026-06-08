// /rewind — rewind to a specific transcript event

import { homedir } from "node:os";
import { join } from "node:path";

import type { Command, CommandContext } from "../registry.js";
import { loadTranscript, getAvailableSessions } from "../../session/resume.js";

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

    const lines: string[] = [
      `Would rewind to event ${targetUuid} (${idx + 1}/${result.events.length}).`,
      `  Keep: ${kept.length} events`,
      `  Remove: ${removed} events`,
      "",
      "Note: Full rewind (truncating transcript) is not yet implemented.",
    ];

    return lines.join("\n");
  },
};

async function findMostRecentSession(sessionsBase: string): Promise<string | null> {
  const sessions = await getAvailableSessions(sessionsBase);
  if (sessions.length === 0) return null;
  return join(sessionsBase, sessions[0]!);
}
