// TaskListTool — list all tasks

import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { getTaskStore } from "./task-store.js";

export const taskListTool: Tool = buildTool({
  name: "TaskList",
  description: "List all tasks",
  security: {
    readOnly: true,
    concurrencySafe: true,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {},
    },
  },
  async execute(_input: ToolInput, _context: ToolContext): Promise<ToolOutput> {
    const store = getTaskStore();

    if (store.size === 0) {
      return { output: "No tasks." };
    }

    const lines: string[] = [];
    for (const task of store.values()) {
      if (task.status === "deleted") continue;
      const statusTag = task.status === "completed" ? " [done]" : task.status === "in_progress" ? " [in progress]" : "";
      lines.push(`${task.id}. ${task.subject}${statusTag}`);
    }

    if (lines.length === 0) {
      return { output: "No tasks." };
    }

    return { output: lines.join("\n") };
  },
});
