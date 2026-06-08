// Default command registry — registers all Phase 1 builtin commands

import { CommandRegistry } from "./registry.js";
export { CommandRegistry } from "./registry.js";
export type { Command, CommandContext } from "./registry.js";
import { helpCommand } from "./builtin/help.js";
import { clearCommand } from "./builtin/clear.js";
import { modelCommand } from "./builtin/model.js";
import { configCommand } from "./builtin/config.js";

/**
 * Create a CommandRegistry with all Phase 1 commands registered.
 */
export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(helpCommand);
  registry.register(clearCommand);
  registry.register(modelCommand);
  registry.register(configCommand);
  return registry;
}
