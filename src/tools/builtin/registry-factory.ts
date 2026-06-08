// Default builtin ToolRegistry factory — registers all builtin tools

import { ToolRegistry } from "../registry.js";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { fileEditTool } from "./file-edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { bashTool } from "./bash.js";
import { agentTool } from "./agent.js";
import { taskCreateTool } from "./task-create.js";
import { taskGetTool } from "./task-get.js";
import { taskListTool } from "./task-list.js";
import { taskUpdateTool } from "./task-update.js";

/**
 * Create a ToolRegistry with all builtin tools registered.
 */
export function createBuiltinRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // File tools (Phase 2)
  registry.registerBuiltin(fileReadTool);
  registry.registerBuiltin(fileWriteTool);
  registry.registerBuiltin(fileEditTool);
  registry.registerBuiltin(globTool);
  registry.registerBuiltin(grepTool);

  // Shell tool (Phase 2)
  registry.registerBuiltin(bashTool);

  // Agent tool (Phase 3)
  registry.registerBuiltin(agentTool);

  // Task tools (Phase 3)
  registry.registerBuiltin(taskCreateTool);
  registry.registerBuiltin(taskGetTool);
  registry.registerBuiltin(taskListTool);
  registry.registerBuiltin(taskUpdateTool);

  return registry;
}
