// /model — view or switch the active model

import type { Command, CommandContext } from "../registry.js";

export const modelCommand: Command = {
  name: "model",
  description: "View or switch the active model",
  usage: "/model [name]",
  execute(args: string, context: CommandContext): string {
    if (!args.trim()) {
      // Show current model
      if (context.model) {
        return `Current model: ${context.model}`;
      }
      return "No model configured.";
    }

    // Switch model
    if (context.setModel) {
      context.setModel(args.trim());
      return `Model switched to: ${args.trim()}`;
    }
    return "Cannot switch model: no setModel handler available.";
  },
};
