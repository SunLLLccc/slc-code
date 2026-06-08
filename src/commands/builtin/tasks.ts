// /tasks — list and manage tasks

import type { Command, CommandContext } from "../registry.js";
import { getTaskStore } from "../../tools/builtin/task-store.js";

export const tasksCommand: Command = {
  name: "tasks",
  description: "List and manage tasks",
  execute(_args: string, _context: CommandContext): string {
    const store = getTaskStore();

    if (store.size === 0) {
      return "No tasks.";
    }

    const lines: string[] = [];
    for (const task of store.values()) {
      if (task.status === "deleted") continue;
      const statusTag =
        task.status === "completed"
          ? " [done]"
          : task.status === "in_progress"
            ? " [in progress]"
            : "";
      lines.push(`${task.id}. ${task.subject}${statusTag}`);
    }

    if (lines.length === 0) {
      return "No tasks.";
    }

    return `Tasks:\n${lines.join("\n")}`;
  },
};
