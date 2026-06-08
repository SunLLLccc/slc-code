// /tasks — list, filter, and manage tasks

import type { Command, CommandContext } from "../registry.js";
import { getTaskStore, type Task } from "../../tools/builtin/task-store.js";

export const tasksCommand: Command = {
  name: "tasks",
  description: "List and manage tasks",
  usage: "/tasks [list|filter <status>|update <id> <status>]",

  execute(args: string, _context: CommandContext): string {
    const store = getTaskStore();
    const trimmed = args.trim();

    // Default: list all non-deleted tasks
    if (!trimmed || trimmed === "list") {
      return formatTasks(getActiveTasks(store));
    }

    // filter <status>
    if (trimmed.startsWith("filter ")) {
      const status = trimmed.slice(7).trim();
      if (!isValidStatus(status)) {
        return `Invalid status "${status}". Use: pending, in_progress, completed, deleted`;
      }
      const filtered = [...store.values()].filter((t) => t.status === status);
      if (filtered.length === 0) {
        return `No tasks with status "${status}".`;
      }
      return formatTasks(filtered);
    }

    // update <id> <status>
    if (trimmed.startsWith("update ")) {
      const parts = trimmed.slice(7).trim().split(/\s+/);
      const id = parts[0];
      const status = parts[1];
      if (!id || !status) {
        return "Usage: /tasks update <id> <status>";
      }
      if (!isValidStatus(status)) {
        return `Invalid status "${status}". Use: pending, in_progress, completed, deleted`;
      }
      const task = store.get(id);
      if (!task) {
        return `Task "${id}" not found.`;
      }
      task.status = status as Task["status"];
      return `Task ${id} updated to "${status}".`;
    }

    return `Unknown subcommand. Usage: ${tasksCommand.usage}`;
  },
};

function getActiveTasks(store: Map<string, Task>): Task[] {
  return [...store.values()].filter((t) => t.status !== "deleted");
}

function formatTasks(tasks: Task[]): string {
  if (tasks.length === 0) {
    return "No tasks.";
  }
  const lines = tasks.map((t, i) => {
    const statusTag = `[${t.status}]`;
    const form = t.activeForm ? ` (${t.activeForm})` : "";
    return `  ${i + 1}. ${t.id} ${statusTag} ${t.subject}${form}`;
  });
  return `Tasks:\n${lines.join("\n")}`;
}

function isValidStatus(s: string): s is Task["status"] {
  return ["pending", "in_progress", "completed", "deleted"].includes(s);
}
