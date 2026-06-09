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
import { webFetchTool } from "./web-fetch.js";
import { webSearchTool } from "./web-search.js";
import { notebookEditTool } from "./notebook-edit.js";
import { scheduleCronTool } from "./schedule-cron.js";
import { skillTool } from "./skill.js";
import { askUserTool } from "./ask-user.js";
import { enterPlanModeTool, exitPlanModeTool } from "./plan-mode.js";
import { enterWorktreeTool } from "./enter-worktree.js";
import { exitWorktreeTool } from "./exit-worktree.js";

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

  // Web tools (Phase 4)
  registry.registerBuiltin(webFetchTool);
  registry.registerBuiltin(webSearchTool);

  // Notebook tool (Phase 4)
  registry.registerBuiltin(notebookEditTool);

  // Schedule tool (Phase 4)
  registry.registerBuiltin(scheduleCronTool);

  // Skill tool (Phase 4)
  registry.registerBuiltin(skillTool);

  // Ask user tool (Phase 4)
  registry.registerBuiltin(askUserTool);

  // Plan mode tools (Phase 4)
  registry.registerBuiltin(enterPlanModeTool);
  registry.registerBuiltin(exitPlanModeTool);

  // Worktree tools (Phase 4)
  registry.registerBuiltin(enterWorktreeTool);
  registry.registerBuiltin(exitWorktreeTool);

  return registry;
}
