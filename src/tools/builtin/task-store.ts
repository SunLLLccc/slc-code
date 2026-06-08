// Shared task store — module-level singleton for task CRUD tools

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Task {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  owner?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Singleton store
// ---------------------------------------------------------------------------

const taskStore = new Map<string, Task>();
let nextId = 1;

export function getTaskStore(): Map<string, Task> {
  return taskStore;
}

export function createTaskId(): string {
  return String(nextId++);
}
