// TaskGetTool — get a task by ID

import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { getTaskStore } from "./task-store.js";

export const taskGetTool: Tool = buildTool({
  name: "TaskGet",
  description: "Get a task by ID",
  security: {
    readOnly: true,
    concurrencySafe: true,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID" },
      },
      required: ["taskId"],
    },
  },
  validate(input: ToolInput): string | undefined {
    const taskId = input.taskId;
    if (typeof taskId !== "string" || taskId.trim() === "") {
      return "taskId must be a non-empty string";
    }
    return undefined;
  },
  async execute(input: ToolInput, _context: ToolContext): Promise<ToolOutput> {
    const taskId = input.taskId as string;
    const task = getTaskStore().get(taskId);

    if (!task) {
      return { output: `Task not found: ${taskId}`, isError: true };
    }

    const parts = [
      `Task ${task.id}: ${task.subject}`,
      `  Status: ${task.status}`,
    ];
    if (task.description) parts.push(`  Description: ${task.description}`);
    if (task.activeForm) parts.push(`  Active form: ${task.activeForm}`);
    if (task.owner) parts.push(`  Owner: ${task.owner}`);

    return { output: parts.join("\n") };
  },
});
