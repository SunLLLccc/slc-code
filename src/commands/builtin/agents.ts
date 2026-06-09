// /agents — show active agents from the task store

import type { Command, CommandContext } from "../registry.js";
import { getTaskStore, type Task } from "../../tools/builtin/task-store.js";

export const agentsCommand: Command = {
  name: "agents",
  description: "List active agents",
  execute(_args: string, _context: CommandContext): string {
    const store = getTaskStore();

    // Agents are tasks with owner set and status in_progress
    const agents = [...store.values()].filter(
      (t: Task) => t.owner && t.status === "in_progress",
    );

    if (agents.length === 0) {
      return "No active agents.";
    }

    const lines = [`Active Agents (${agents.length}):\n`];

    for (const agent of agents) {
      const form = agent.activeForm ? ` — ${agent.activeForm}` : "";
      lines.push(`  ${agent.id} [${agent.owner}] ${agent.subject}${form}`);
    }

    return lines.join("\n");
  },
};
