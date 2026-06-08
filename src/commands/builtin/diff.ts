// /diff — show current working tree diff

import { execFileSync } from "node:child_process";
import type { Command, CommandContext } from "../registry.js";

const MAX_DIFF_LENGTH = 5000;

export const diffCommand: Command = {
  name: "diff",
  description: "Show current working tree diff",

  execute(_args: string, _context: CommandContext): string {
    try {
      const output = execFileSync("git", ["diff"], {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });

      if (!output.trim()) {
        return "No changes in working tree.";
      }

      if (output.length > MAX_DIFF_LENGTH) {
        return output.slice(0, MAX_DIFF_LENGTH) + "\n... (truncated, use git diff for full output)";
      }

      return output;
    } catch {
      return "git not available";
    }
  },
};
