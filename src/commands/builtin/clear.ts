// /clear — clear the conversation history

import type { Command, CommandContext } from "../registry.js";

export const clearCommand: Command = {
  name: "clear",
  description: "Clear conversation history",
  execute(_args: string, context: CommandContext): string {
    if (context.clearConversation) {
      context.clearConversation();
      return "Conversation cleared.";
    }
    return "No conversation to clear.";
  },
};
