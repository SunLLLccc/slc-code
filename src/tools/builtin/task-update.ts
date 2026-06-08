// TaskUpdateTool — update a task

import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { getTaskStore, type Task } from "./task-store.js";

const VALID_STATUSES = new Set(["pending", "in_progress", "completed", "deleted"]);

export const taskUpdateTool: Tool = buildTool({
  name: "TaskUpdate",
  description: "Update a task",
  security: {
    readOnly: false,
    concurrencySafe: true,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID" },
        status: {
          type: "string",
          description: 'New status: "pending"|"in_progress"|"completed"|"deleted"',
        },
        subject: { type: "string", description: "New subject" },
        description: { type: "string", description: "New description" },
      },
      required: ["taskId"],
    },
  },
  validate(input: ToolInput): string | undefined {
    const taskId = input.taskId;
    if (typeof taskId !== "string" || taskId.trim() === "") {
      return "taskId must be a non-empty string";
    }
    const status = input.status as string | undefined;
    if (status !== undefined && !VALID_STATUSES.has(status)) {
      return `status must be one of: ${[...VALID_STATUSES].join(", ")}`;
    }
    return undefined;
  },
  async execute(input: ToolInput, _context: ToolContext): Promise<ToolOutput> {
    const taskId = input.taskId as string;
    const store = getTaskStore();
    const task = store.get(taskId);

    if (!task) {
      return { output: `Task not found: ${taskId}`, isError: true };
    }

    const status = input.status as Task["status"] | undefined;
    const subject = input.subject as string | undefined;
    const description = input.description as string | undefined;

    if (status !== undefined) task.status = status;
    if (subject !== undefined) task.subject = subject;
    if (description !== undefined) task.description = description;

    return { output: `Updated task ${taskId}: ${task.subject}` };
  },
});
