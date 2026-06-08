// TaskCreateTool — create a new task

import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { getTaskStore, createTaskId, type Task } from "./task-store.js";

export const taskCreateTool: Tool = buildTool({
  name: "TaskCreate",
  description: "Create a new task",
  security: {
    readOnly: false,
    concurrencySafe: true,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description" },
        activeForm: {
          type: "string",
          description: "Present continuous form shown in spinner",
        },
      },
      required: ["subject"],
    },
  },
  validate(input: ToolInput): string | undefined {
    const subject = input.subject;
    if (typeof subject !== "string" || subject.trim() === "") {
      return "subject must be a non-empty string";
    }
    return undefined;
  },
  async execute(input: ToolInput, _context: ToolContext): Promise<ToolOutput> {
    const id = createTaskId();
    const task: Task = {
      id,
      subject: input.subject as string,
      description: input.description as string | undefined,
      activeForm: input.activeForm as string | undefined,
      status: "pending",
    };

    getTaskStore().set(id, task);

    return {
      output: `Created task ${id}: ${task.subject}`,
      metadata: { taskId: id },
    };
  },
});
