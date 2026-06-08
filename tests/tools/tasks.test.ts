// Tests for Task CRUD tools and task-store

import { describe, it, expect, beforeEach } from "vitest";
import { getTaskStore, createTaskId } from "../../src/tools/builtin/task-store.js";
import { taskCreateTool } from "../../src/tools/builtin/task-create.js";
import { taskGetTool } from "../../src/tools/builtin/task-get.js";
import { taskListTool } from "../../src/tools/builtin/task-list.js";
import { taskUpdateTool } from "../../src/tools/builtin/task-update.js";
import type { ToolContext } from "../../src/tools/base.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CTX: ToolContext = { cwd: "/tmp" };

function clearStore(): void {
  getTaskStore().clear();
}

// ---------------------------------------------------------------------------
// task-store: createTaskId
// ---------------------------------------------------------------------------

describe("createTaskId", () => {
  it("generates sequential string IDs", () => {
    const id1 = createTaskId();
    const id2 = createTaskId();
    const id3 = createTaskId();
    expect(typeof id1).toBe("string");
    expect(Number(id2)).toBe(Number(id1) + 1);
    expect(Number(id3)).toBe(Number(id2) + 1);
  });
});

// ---------------------------------------------------------------------------
// TaskCreateTool
// ---------------------------------------------------------------------------

describe("TaskCreateTool", () => {
  beforeEach(() => clearStore());

  it("has correct name", () => {
    expect(taskCreateTool.name).toBe("TaskCreate");
  });

  it("has security attributes: not readOnly, concurrencySafe, not destructive", () => {
    expect(taskCreateTool.security.readOnly).toBe(false);
    expect(taskCreateTool.security.concurrencySafe).toBe(true);
    expect(taskCreateTool.security.destructive).toBe(false);
  });

  it("creates a task and returns ID in output", async () => {
    const result = await taskCreateTool.execute({ subject: "Test task" }, CTX);
    expect(result.output).toContain("Created task");
    expect(result.metadata?.taskId).toBeDefined();
  });

  it("stores the created task in getTaskStore", async () => {
    const result = await taskCreateTool.execute({ subject: "My task" }, CTX);
    const id = result.metadata!.taskId as string;
    const task = getTaskStore().get(id);
    expect(task).toBeDefined();
    expect(task!.subject).toBe("My task");
    expect(task!.status).toBe("pending");
  });

  it("stores optional description and activeForm", async () => {
    const result = await taskCreateTool.execute(
      { subject: "S", description: "D", activeForm: "Doing" },
      CTX,
    );
    const id = result.metadata!.taskId as string;
    const task = getTaskStore().get(id);
    expect(task!.description).toBe("D");
    expect(task!.activeForm).toBe("Doing");
  });

  it("validate rejects empty subject", () => {
    expect(taskCreateTool.validate!({ subject: "" })).toBeDefined();
    expect(taskCreateTool.validate!({ subject: "   " })).toBeDefined();
    expect(taskCreateTool.validate!({})).toBeDefined();
  });

  it("validate accepts valid subject", () => {
    expect(taskCreateTool.validate!({ subject: "ok" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TaskGetTool
// ---------------------------------------------------------------------------

describe("TaskGetTool", () => {
  beforeEach(() => clearStore());

  it("has correct name", () => {
    expect(taskGetTool.name).toBe("TaskGet");
  });

  it("has security attributes: readOnly, concurrencySafe, not destructive", () => {
    expect(taskGetTool.security.readOnly).toBe(true);
    expect(taskGetTool.security.concurrencySafe).toBe(true);
    expect(taskGetTool.security.destructive).toBe(false);
  });

  it("retrieves a task by ID", async () => {
    // Create first
    const created = await taskCreateTool.execute({ subject: "Find me" }, CTX);
    const id = created.metadata!.taskId as string;

    const result = await taskGetTool.execute({ taskId: id }, CTX);
    expect(result.output).toContain("Find me");
    expect(result.output).toContain(`Task ${id}`);
    expect(result.isError).toBeFalsy();
  });

  it("returns error for missing task", async () => {
    const result = await taskGetTool.execute({ taskId: "999" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Task not found");
  });

  it("validate rejects empty taskId", () => {
    expect(taskGetTool.validate!({ taskId: "" })).toBeDefined();
    expect(taskGetTool.validate!({ taskId: "   " })).toBeDefined();
    expect(taskGetTool.validate!({})).toBeDefined();
  });

  it("includes optional fields in output", async () => {
    const created = await taskCreateTool.execute(
      { subject: "Full", description: "Desc text", activeForm: "Working" },
      CTX,
    );
    const id = created.metadata!.taskId as string;
    const result = await taskGetTool.execute({ taskId: id }, CTX);
    expect(result.output).toContain("Description: Desc text");
    expect(result.output).toContain("Active form: Working");
  });
});

// ---------------------------------------------------------------------------
// TaskListTool
// ---------------------------------------------------------------------------

describe("TaskListTool", () => {
  beforeEach(() => clearStore());

  it("has correct name", () => {
    expect(taskListTool.name).toBe("TaskList");
  });

  it("has security attributes: readOnly, concurrencySafe, not destructive", () => {
    expect(taskListTool.security.readOnly).toBe(true);
    expect(taskListTool.security.concurrencySafe).toBe(true);
    expect(taskListTool.security.destructive).toBe(false);
  });

  it("returns 'No tasks.' when store is empty", async () => {
    const result = await taskListTool.execute({}, CTX);
    expect(result.output).toBe("No tasks.");
  });

  it("lists tasks after creation", async () => {
    await taskCreateTool.execute({ subject: "Task A" }, CTX);
    await taskCreateTool.execute({ subject: "Task B" }, CTX);

    const result = await taskListTool.execute({}, CTX);
    expect(result.output).toContain("Task A");
    expect(result.output).toContain("Task B");
  });

  it("filters deleted tasks", async () => {
    const created = await taskCreateTool.execute({ subject: "Gone" }, CTX);
    const id = created.metadata!.taskId as string;
    await taskUpdateTool.execute({ taskId: id, status: "deleted" }, CTX);

    const result = await taskListTool.execute({}, CTX);
    expect(result.output).toBe("No tasks.");
  });

  it("shows status tags for completed and in_progress", async () => {
    const c1 = await taskCreateTool.execute({ subject: "Done task" }, CTX);
    const c2 = await taskCreateTool.execute({ subject: "Active task" }, CTX);
    await taskUpdateTool.execute({ taskId: c1.metadata!.taskId as string, status: "completed" }, CTX);
    await taskUpdateTool.execute({ taskId: c2.metadata!.taskId as string, status: "in_progress" }, CTX);

    const result = await taskListTool.execute({}, CTX);
    expect(result.output).toContain("[done]");
    expect(result.output).toContain("[in progress]");
  });
});

// ---------------------------------------------------------------------------
// TaskUpdateTool
// ---------------------------------------------------------------------------

describe("TaskUpdateTool", () => {
  beforeEach(() => clearStore());

  it("has correct name", () => {
    expect(taskUpdateTool.name).toBe("TaskUpdate");
  });

  it("has security attributes: not readOnly, concurrencySafe, not destructive", () => {
    expect(taskUpdateTool.security.readOnly).toBe(false);
    expect(taskUpdateTool.security.concurrencySafe).toBe(true);
    expect(taskUpdateTool.security.destructive).toBe(false);
  });

  it("updates task status", async () => {
    const created = await taskCreateTool.execute({ subject: "Update me" }, CTX);
    const id = created.metadata!.taskId as string;

    const result = await taskUpdateTool.execute({ taskId: id, status: "in_progress" }, CTX);
    expect(result.output).toContain("Updated task");

    const task = getTaskStore().get(id);
    expect(task!.status).toBe("in_progress");
  });

  it("updates task subject", async () => {
    const created = await taskCreateTool.execute({ subject: "Old name" }, CTX);
    const id = created.metadata!.taskId as string;

    await taskUpdateTool.execute({ taskId: id, subject: "New name" }, CTX);
    const task = getTaskStore().get(id);
    expect(task!.subject).toBe("New name");
  });

  it("returns error for missing task", async () => {
    const result = await taskUpdateTool.execute({ taskId: "999", status: "completed" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Task not found");
  });

  it("validate rejects empty taskId", () => {
    expect(taskUpdateTool.validate!({ taskId: "" })).toBeDefined();
    expect(taskUpdateTool.validate!({ taskId: "   " })).toBeDefined();
    expect(taskUpdateTool.validate!({})).toBeDefined();
  });

  it("validate rejects invalid status", () => {
    expect(taskUpdateTool.validate!({ taskId: "1", status: "bogus" })).toBeDefined();
  });

  it("validate accepts valid status", () => {
    expect(taskUpdateTool.validate!({ taskId: "1", status: "completed" })).toBeUndefined();
  });
});
