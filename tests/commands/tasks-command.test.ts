// Tests for /tasks command

import { describe, it, expect, beforeEach } from "vitest";
import { tasksCommand } from "../../src/commands/builtin/tasks.js";
import { createDefaultRegistry } from "../../src/commands/index.js";
import { getTaskStore } from "../../src/tools/builtin/task-store.js";
import { taskCreateTool } from "../../src/tools/builtin/task-create.js";
import type { CommandContext } from "../../src/commands/registry.js";
import type { ToolContext } from "../../src/tools/base.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CMD_CTX: CommandContext = {};
const TOOL_CTX: ToolContext = { cwd: "/tmp" };

function clearStore(): void {
  getTaskStore().clear();
}

// ---------------------------------------------------------------------------
// /tasks command
// ---------------------------------------------------------------------------

describe("/tasks command", () => {
  beforeEach(() => clearStore());

  it("returns 'No tasks.' when store is empty", () => {
    const result = tasksCommand.execute("", CMD_CTX);
    expect(result).toBe("No tasks.");
  });

  it("lists tasks after creation", async () => {
    await taskCreateTool.execute({ subject: "Task A" }, TOOL_CTX);
    await taskCreateTool.execute({ subject: "Task B" }, TOOL_CTX);

    const result = tasksCommand.execute("", CMD_CTX);
    expect(result).toContain("Tasks:");
    expect(result).toContain("Task A");
    expect(result).toContain("Task B");
  });

  it("returns 'No tasks.' when all tasks are deleted", async () => {
    const created = await taskCreateTool.execute({ subject: "Gone" }, TOOL_CTX);
    const id = created.metadata!.taskId as string;
    const store = getTaskStore();
    const task = store.get(id)!;
    task.status = "deleted";

    const result = tasksCommand.execute("", CMD_CTX);
    expect(result).toBe("No tasks.");
  });

  it("has correct name and description", () => {
    expect(tasksCommand.name).toBe("tasks");
    expect(tasksCommand.description).toBeTruthy();
  });

  it("filter by status", async () => {
    await taskCreateTool.execute({ subject: "Pending task" }, TOOL_CTX);
    const created = await taskCreateTool.execute({ subject: "Done task" }, TOOL_CTX);
    const id = created.metadata!.taskId as string;
    getTaskStore().get(id)!.status = "completed";

    const result = tasksCommand.execute("filter completed", CMD_CTX);
    expect(result).toContain("Done task");
    expect(result).not.toContain("Pending task");
  });

  it("filter returns message when no matches", async () => {
    await taskCreateTool.execute({ subject: "Pending" }, TOOL_CTX);
    const result = tasksCommand.execute("filter completed", CMD_CTX);
    expect(result).toContain("No tasks with status");
  });

  it("filter rejects invalid status", () => {
    const result = tasksCommand.execute("filter bogus", CMD_CTX);
    expect(result).toContain("Invalid status");
  });

  it("update task status", async () => {
    const created = await taskCreateTool.execute({ subject: "Updatable" }, TOOL_CTX);
    const id = created.metadata!.taskId as string;

    const result = tasksCommand.execute(`update ${id} completed`, CMD_CTX);
    expect(result).toContain("updated");
    expect(result).toContain("completed");
    expect(getTaskStore().get(id)!.status).toBe("completed");
  });

  it("update returns error for unknown id", () => {
    const result = tasksCommand.execute("update nonexistent completed", CMD_CTX);
    expect(result).toContain("not found");
  });

  it("update rejects invalid status", async () => {
    const created = await taskCreateTool.execute({ subject: "X" }, TOOL_CTX);
    const id = created.metadata!.taskId as string;
    const result = tasksCommand.execute(`update ${id} bogus`, CMD_CTX);
    expect(result).toContain("Invalid status");
  });

  it("update returns usage when missing args", () => {
    const result = tasksCommand.execute("update", CMD_CTX);
    expect(result).toContain("Unknown subcommand");
  });
});

// ---------------------------------------------------------------------------
// /tasks in createDefaultRegistry
// ---------------------------------------------------------------------------

describe("/tasks in createDefaultRegistry", () => {
  beforeEach(() => clearStore());

  it("is registered in the default registry", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("tasks")).toBe(true);
  });

  it("can be dispatched via the registry", async () => {
    // Create a task first
    await taskCreateTool.execute({ subject: "Registered task" }, TOOL_CTX);

    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/tasks", CMD_CTX);
    expect(result).toContain("Registered task");
  });
});
