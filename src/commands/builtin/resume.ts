// /resume — resume a previous session

import { homedir } from "node:os";
import { join } from "node:path";

import type { Command, CommandContext } from "../registry.js";
import { loadTranscript, getAvailableSessions } from "../../session/resume.js";

const DEFAULT_SESSIONS_BASE = join(homedir(), ".slc", "sessions");

export const resumeCommand: Command = {
  name: "resume",
  description: "Resume a previous session",
  usage: "/resume [session-id]",

  async execute(args: string, context: CommandContext): Promise<string> {
    const sessionsBase = (context.config?.sessionsBase as string) ?? DEFAULT_SESSIONS_BASE;
    const sessions = await getAvailableSessions(sessionsBase);

    if (sessions.length === 0) {
      return "No sessions found.";
    }

    const sessionId = args.trim() || sessions[0]!;
    const sessionDir = join(sessionsBase, sessionId);

    const result = await loadTranscript(sessionDir);

    if (!result.success) {
      return `Failed to load session: ${result.error ?? "unknown error"}`;
    }

    if (result.events.length === 0) {
      return `Session "${sessionId}" is empty (no events).`;
    }

    // Derive title from first user event
    let title = "Untitled session";
    for (const event of result.events) {
      if (event.type === "user" && event.content) {
        title = event.content.length > 80
          ? event.content.slice(0, 80) + "..."
          : event.content;
        break;
      }
    }

    return `Resumed session "${sessionId}"\n  Title: ${title}\n  Events: ${result.events.length}`;
  },
};
