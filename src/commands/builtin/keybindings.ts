// /keybindings — show REPL keybindings (hardcoded reference)

import type { Command, CommandContext } from "../registry.js";

const KEYBINDINGS = [
  { keys: "Enter", action: "Submit input / confirm" },
  { keys: "Ctrl+C", action: "Cancel current input / interrupt" },
  { keys: "Ctrl+D", action: "Exit (EOF)" },
  { keys: "Ctrl+L", action: "Clear screen" },
  { keys: "Up / Down", action: "Navigate command history" },
  { keys: "Tab", action: "Autocomplete" },
  { keys: "Ctrl+A", action: "Move cursor to start of line" },
  { keys: "Ctrl+E", action: "Move cursor to end of line" },
  { keys: "Ctrl+K", action: "Delete to end of line" },
  { keys: "Ctrl+U", action: "Delete to start of line" },
  { keys: "Ctrl+W", action: "Delete word backward" },
  { keys: "Escape", action: "Cancel current input" },
];

export const keybindingsCommand: Command = {
  name: "keybindings",
  description: "Show REPL keybindings",
  execute(_args: string, _context: CommandContext): string {
    const lines = ["REPL Keybindings:\n"];
    for (const kb of KEYBINDINGS) {
      lines.push(`  ${kb.keys.padEnd(20)} ${kb.action}`);
    }
    return lines.join("\n");
  },
};
