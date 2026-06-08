// /config — view current configuration

import type { Command, CommandContext } from "../registry.js";

export const configCommand: Command = {
  name: "config",
  description: "View current configuration",
  execute(_args: string, context: CommandContext): string {
    if (!context.config || Object.keys(context.config).length === 0) {
      return "No configuration loaded.";
    }
    return JSON.stringify(context.config, null, 2);
  },
};
