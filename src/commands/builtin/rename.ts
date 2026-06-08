// /rename — rename the current session

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Command, CommandContext } from "../registry.js";

export const renameCommand: Command = {
  name: "rename",
  description: "Rename the current session",
  usage: "/rename <new-title>",

  async execute(args: string, context: CommandContext): Promise<string> {
    const newTitle = args.trim();

    if (!newTitle) {
      return "Usage: /rename <new-title>";
    }

    // Session directory comes from config when available
    const sessionDir = context.config?.sessionDir as string | undefined;

    if (!sessionDir) {
      return "Session directory not available. Cannot rename session.";
    }

    const metadataPath = join(sessionDir, "metadata.json");

    try {
      await mkdir(sessionDir, { recursive: true });
      await writeFile(
        metadataPath,
        JSON.stringify({ title: newTitle }, null, 2) + "\n",
        { mode: 0o600 },
      );
      return `Session renamed to: ${newTitle}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Failed to rename session: ${message}`;
    }
  },
};
