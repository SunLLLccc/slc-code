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
