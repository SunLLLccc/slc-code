// /session — list available sessions

import { homedir } from "node:os";
import { join } from "node:path";

import type { Command, CommandContext } from "../registry.js";
import { getAvailableSessions, getSessionMetadata } from "../../session/resume.js";

const DEFAULT_SESSIONS_BASE = join(homedir(), ".slc", "sessions");

export const sessionCommand: Command = {
  name: "session",
  description: "List available sessions",

  async execute(_args: string, context: CommandContext): Promise<string> {
    const sessionsBase = (context.config?.sessionsBase as string) ?? DEFAULT_SESSIONS_BASE;
    const sessions = await getAvailableSessions(sessionsBase);

    if (sessions.length === 0) {
      return "No sessions found.";
    }

    const lines: string[] = [];

    for (let i = 0; i < sessions.length; i++) {
      const sessionId = sessions[i]!;
      const sessionDir = join(sessionsBase, sessionId);
      const meta = await getSessionMetadata(sessionDir);

      if (meta) {
        const date = new Date(meta.lastModified).toLocaleString();
        const eventWord = meta.eventCount === 1 ? "event" : "events";
        lines.push(`  ${i + 1}. ${meta.title} (${meta.eventCount} ${eventWord}, ${date})`);
      } else {
        lines.push(`  ${i + 1}. ${sessionId} (no metadata)`);
      }
    }

    return `Available sessions:\n${lines.join("\n")}`;
  },
};
