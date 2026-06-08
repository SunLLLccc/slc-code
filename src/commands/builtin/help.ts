// /help — list available slash commands

import type { Command, CommandContext } from "../registry.js";

export const helpCommand: Command = {
  name: "help",
  description: "Show available slash commands",
  aliases: ["h", "?"],
  execute(_args: string, _context: CommandContext): string {
    return "Available commands:\n  /help    — Show this help\n  /clear   — Clear conversation\n  /model   — View or switch model\n  /config  — View current configuration";
  },
};
