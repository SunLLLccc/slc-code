// Command registry — slash command dispatch for the REPL

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Command {
  /** Slash command name (e.g. "help"). */
  name: string;
  /** Short description. */
  description: string;
  /** Usage string (e.g. "/model <name>"). */
  usage?: string;
  /** Alternative names. */
  aliases?: string[];
  /** Hide from /help listing. */
  hidden?: boolean;
  /** Execute the command. Return output string or void. */
  execute(args: string, context: CommandContext): string | Promise<string>;
}

export interface CommandContext {
  /** Get/set the current model. */
  model?: string;
  setModel?: (model: string) => void;
  /** Clear the conversation. */
  clearConversation?: () => void;
  /** Cost tracker summary. */
  costSummary?: () => string;
  /** Current configuration (read-only snapshot). */
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  private readonly aliasMap = new Map<string, string>();

  /** Register a command. */
  register(command: Command): void {
    this.commands.set(command.name, command);
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliasMap.set(alias, command.name);
      }
    }
  }

  /** Look up a command by name or alias. */
  get(name: string): Command | undefined {
    return this.commands.get(name) ?? this.commands.get(this.aliasMap.get(name) ?? "");
  }

  /** Check if a command exists. */
  has(name: string): boolean {
    return this.commands.has(name) || this.aliasMap.has(name);
  }

  /** List all visible commands (not hidden). */
  list(): Command[] {
    return [...this.commands.values()].filter((c) => !c.hidden);
  }

  /**
   * Dispatch a slash command input string.
   * Returns the command output, or throws if command not found.
   */
  async dispatch(input: string, context: CommandContext): Promise<string> {
    // input is like "/help" or "/model gpt-4o"
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) {
      throw new Error(`Not a slash command: ${trimmed}`);
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const name = parts[0] ?? "";
    const args = parts.slice(1).join(" ");

    const command = this.get(name);
    if (!command) {
      return `Unknown command: /${name}. Type /help for available commands.`;
    }

    return command.execute(args, context);
  }
}
