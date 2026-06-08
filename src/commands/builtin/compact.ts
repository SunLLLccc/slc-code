// /compact — compact conversation history

import type { Command, CommandContext } from "../registry.js";

export const compactCommand: Command = {
  name: "compact",
  aliases: ["c"],
  description: "Compact conversation history",
  execute(_args: string, context: CommandContext): string {
    if (context.compactMessages) {
      context.compactMessages();
      return "Conversation compacted.";
    }
    return "Compact not available.";
  },
};
