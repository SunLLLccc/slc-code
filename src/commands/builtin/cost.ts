// /cost — show current session cost

import type { Command, CommandContext } from "../registry.js";

export const costCommand: Command = {
  name: "cost",
  description: "Show current session cost",

  execute(_args: string, context: CommandContext): string {
    if (!context.costSummary) {
      return "Cost tracking not available";
    }
    return context.costSummary();
  },
};
