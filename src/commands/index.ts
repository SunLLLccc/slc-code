// Default command registry — registers all builtin commands

import { CommandRegistry } from "./registry.js";
export { CommandRegistry } from "./registry.js";
export type { Command, CommandContext } from "./registry.js";
import { helpCommand } from "./builtin/help.js";
import { clearCommand } from "./builtin/clear.js";
import { modelCommand } from "./builtin/model.js";
import { configCommand } from "./builtin/config.js";
import { permissionsCommand } from "./builtin/permissions.js";
import { diffCommand } from "./builtin/diff.js";
import { costCommand } from "./builtin/cost.js";

/**
 * Create a CommandRegistry with all builtin commands registered.
 */
export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  // Phase 1
  registry.register(helpCommand);
  registry.register(clearCommand);
  registry.register(modelCommand);
  registry.register(configCommand);
  // Phase 2
  registry.register(permissionsCommand);
  registry.register(diffCommand);
  registry.register(costCommand);
  return registry;
}
