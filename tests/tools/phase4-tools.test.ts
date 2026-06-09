// Tests for Phase 4 tools: real functionality tests

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Tool, ToolContext, ToolInput } from "../../src/tools/base.js";
import { webFetchTool } from "../../src/tools/builtin/web-fetch.js";
import { webSearchTool, setSearchProvider, getSearchProvider, type SearchProvider, type SearchResult } from "../../src/tools/builtin/web-search.js";
import { notebookEditTool } from "../../src/tools/builtin/notebook-edit.js";
import { scheduleCronTool } from "../../src/tools/builtin/schedule-cron.js";
import { skillTool } from "../../src/tools/builtin/skill.js";
import { askUserTool, type AskUserCallback } from "../../src/tools/builtin/ask-user.js";
import { enterPlanModeTool, exitPlanModeTool, getPlanModeState, resetPlanModeState } from "../../src/tools/builtin/plan-mode.js";
import { enterWorktreeTool } from "../../src/tools/builtin/enter-worktree.js";
import { exitWorktreeTool } from "../../src/tools/builtin/exit-worktree.js";
import { createBuiltinRegistry } from "../../src/tools/builtin/registry-factory.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "phase4-test-"));
  resetPlanModeState();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// WebFetchTool
// ---------------------------------------------------------------------------

describe("WebFetchTool", () => {
  it("has correct name and security attributes", () => {
    expect(webFetchTool.name).toBe("WebFetch");
    expect(webFetchTool.security.readOnly).toBe(true);
    expect(webFetchTool.security.concurrencySafe).toBe(true);
    expect(webFetchTool.security.destructive).toBe(false);
  });

  it("requires url in schema", () => {
    const required = (webFetchTool.schema.input as Record<string, unknown>).required as string[];
    expect(required).toContain("url");
  });

  it("fetches content successfully (mocked)", async () => {
    const originalFetch = globalThis.fetch;
    const encoder = new TextEncoder();
    const body = "<html>Hello World</html>";
    const chunks = [encoder.encode(body)];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => {
          let i = 0;
          return {
            read: async () => {
              if (i < chunks.length) return { done: false, value: chunks[i++] };
              return { done: true, value: undefined };
            },
            cancel: vi.fn(),
          };
        },
      },
    }) as unknown as typeof fetch;

    try {
      const ctx: ToolContext = { cwd: tmpDir };
      const result = await webFetchTool.execute({ url: "https://example.com" }, ctx);
      expect(result.isError).toBeUndefined();
      expect(result.output).toContain("Hello World");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns error for HTTP 404", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve("Not Found"),
    }) as unknown as typeof fetch;

    try {
      const ctx: ToolContext = { cwd: tmpDir };
      const result = await webFetchTool.execute({ url: "https://example.com/missing" }, ctx);
      expect(result.isError).toBe(true);
      expect(result.output).toContain("404");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns error for fetch failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;

    try {
      const ctx: ToolContext = { cwd: tmpDir };
      const result = await webFetchTool.execute({ url: "https://bad.example" }, ctx);
      expect(result.isError).toBe(true);
      expect(result.output).toContain("Fetch error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("truncates long responses", async () => {
    const originalFetch = globalThis.fetch;
    const longContent = "x".repeat(60000); // > 50KB limit
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(longContent),
    }) as unknown as typeof fetch;

    try {
      const ctx: ToolContext = { cwd: tmpDir };
      const result = await webFetchTool.execute({ url: "https://example.com/long" }, ctx);
      expect(result.output.length).toBeLessThanOrEqual(52000); // 50KB + truncation message
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// WebSearchTool
// ---------------------------------------------------------------------------

describe("WebSearchTool", () => {
  it("has correct name and security attributes", () => {
    expect(webSearchTool.name).toBe("WebSearch");
    expect(webSearchTool.security.readOnly).toBe(true);
    expect(webSearchTool.security.concurrencySafe).toBe(true);
    expect(webSearchTool.security.destructive).toBe(false);
  });

  it("requires query in schema", () => {
    const required = (webSearchTool.schema.input as Record<string, unknown>).required as string[];
    expect(required).toContain("query");
  });

  it("returns no-results message when no provider configured", async () => {
    // Reset to default (no provider)
    setSearchProvider(null as unknown as SearchProvider);
    const ctx: ToolContext = { cwd: tmpDir };
    const result = await webSearchTool.execute({ query: "test" }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("No search");
  });

  it("uses configured search provider", async () => {
    const mockResults: SearchResult[] = [
      { title: "Test Result", url: "https://example.com", snippet: "A test snippet" },
    ];
    const provider: SearchProvider = {
      async search(query: string, maxResults?: number): Promise<SearchResult[]> {
        expect(query).toBe("hello world");
        expect(maxResults).toBe(5);
        return mockResults;
      },
    };
    setSearchProvider(provider);

    const ctx: ToolContext = { cwd: tmpDir };
    const result = await webSearchTool.execute({ query: "hello world", maxResults: 5 }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("Test Result");
    expect(result.output).toContain("https://example.com");
    expect(result.output).toContain("A test snippet");
  });

  it("handles search provider errors gracefully", async () => {
    const provider: SearchProvider = {
      async search(): Promise<SearchResult[]> {
        throw new Error("API key missing");
      },
    };
    setSearchProvider(provider);

    const ctx: ToolContext = { cwd: tmpDir };
    const result = await webSearchTool.execute({ query: "test" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("API key missing");
  });
});

// ---------------------------------------------------------------------------
// NotebookEditTool
// ---------------------------------------------------------------------------

function makeNotebook(cells: Array<{ id: string; cell_type: string; source: string[] }>): string {
  return JSON.stringify({
    cells: cells.map((c) => ({
      id: c.id,
      cell_type: c.cell_type,
      metadata: {},
      source: c.source,
      ...(c.cell_type === "code" ? { outputs: [], execution_count: null } : {}),
    })),
    metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" } },
    nbformat: 4,
    nbformat_minor: 5,
  }, null, 2) + "\n";
}

describe("NotebookEditTool", () => {
  it("has correct name and security attributes", () => {
    expect(notebookEditTool.name).toBe("NotebookEdit");
    expect(notebookEditTool.security.readOnly).toBe(false);
    expect(notebookEditTool.security.concurrencySafe).toBe(false);
    expect(notebookEditTool.security.destructive).toBe(false);
  });

  it("validates notebook path must end with .ipynb", () => {
    const err = notebookEditTool.validate?.({ notebook_path: "/tmp/test.txt", cell_id: "a", new_source: "x" });
    expect(err).toContain(".ipynb");
  });

  it("validates edit_mode", () => {
    const err = notebookEditTool.validate?.({ notebook_path: "/tmp/test.ipynb", cell_id: "a", new_source: "x", edit_mode: "invalid" });
    expect(err).toContain("edit_mode");
  });

  it("replaces a cell's source content", async () => {
    const nbPath = join(tmpDir, "test.ipynb");
    await writeFile(nbPath, makeNotebook([
      { id: "cell1", cell_type: "code", source: ["print('old')"] },
    ]));

    const ctx: ToolContext = { cwd: tmpDir };
    const result = await notebookEditTool.execute(
      { notebook_path: "test.ipynb", cell_id: "cell1", new_source: "print('new')" },
      ctx,
    );
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("replace");

    const raw = await readFile(nbPath, "utf-8");
    const nb = JSON.parse(raw);
    expect(nb.cells[0].source).toEqual(["print('new')"]);
    expect(nb.metadata.kernelspec.display_name).toBe("Python 3");
  });

  it("inserts a cell after the target", async () => {
    const nbPath = join(tmpDir, "insert.ipynb");
    await writeFile(nbPath, makeNotebook([
      { id: "cell1", cell_type: "code", source: ["x = 1"] },
      { id: "cell2", cell_type: "code", source: ["y = 2"] },
    ]));

    const ctx: ToolContext = { cwd: tmpDir };
    const result = await notebookEditTool.execute(
      { notebook_path: "insert.ipynb", cell_id: "cell1", new_source: "z = 3", edit_mode: "insert", cell_type: "code" },
      ctx,
    );
    expect(result.isError).toBeUndefined();

    const raw = await readFile(nbPath, "utf-8");
    const nb = JSON.parse(raw);
    expect(nb.cells).toHaveLength(3);
    expect(nb.cells[1].source).toEqual(["z = 3"]);
    expect(nb.cells[1].id).toBeTruthy();
    expect(nb.cells[2].id).toBe("cell2");
  });

  it("deletes a cell", async () => {
    const nbPath = join(tmpDir, "delete.ipynb");
    await writeFile(nbPath, makeNotebook([
      { id: "cell1", cell_type: "code", source: ["x = 1"] },
      { id: "cell2", cell_type: "code", source: ["y = 2"] },
    ]));

    const ctx: ToolContext = { cwd: tmpDir };
    const result = await notebookEditTool.execute(
      { notebook_path: "delete.ipynb", cell_id: "cell1", new_source: "", edit_mode: "delete" },
      ctx,
    );
    expect(result.isError).toBeUndefined();

    const raw = await readFile(nbPath, "utf-8");
    const nb = JSON.parse(raw);
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0].id).toBe("cell2");
  });

  it("returns error for non-existent cell", async () => {
    const nbPath = join(tmpDir, "nocell.ipynb");
    await writeFile(nbPath, makeNotebook([
      { id: "cell1", cell_type: "code", source: ["x = 1"] },
    ]));

    const ctx: ToolContext = { cwd: tmpDir };
    const result = await notebookEditTool.execute(
      { notebook_path: "nocell.ipynb", cell_id: "nonexistent", new_source: "x" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Cell not found");
  });

  it("returns error for non-existent file", async () => {
    const ctx: ToolContext = { cwd: tmpDir };
    const result = await notebookEditTool.execute(
      { notebook_path: "missing.ipynb", cell_id: "a", new_source: "x" },
      ctx,
    );
    expect(result.isError).toBe(true);
  });

  it("returns error for invalid JSON notebook", async () => {
    const nbPath = join(tmpDir, "bad.json.ipynb");
    await writeFile(nbPath, "not valid json");

    const ctx: ToolContext = { cwd: tmpDir };
    const result = await notebookEditTool.execute(
      { notebook_path: "bad.json.ipynb", cell_id: "a", new_source: "x" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Invalid notebook JSON");
  });
});

// ---------------------------------------------------------------------------
// ScheduleCronTool
// ---------------------------------------------------------------------------

describe("ScheduleCronTool", () => {
  it("has correct name and security attributes", () => {
    expect(scheduleCronTool.name).toBe("ScheduleCron");
    expect(scheduleCronTool.security.readOnly).toBe(false);
    expect(scheduleCronTool.security.concurrencySafe).toBe(true);
    expect(scheduleCronTool.security.destructive).toBe(false);
  });

  it("validates cron format — too few fields", () => {
    const err = scheduleCronTool.validate?.({ cron: "* * *", prompt: "test" });
    expect(err).toContain("Invalid cron");
  });

  it("validates cron format — invalid characters", () => {
    const err = scheduleCronTool.validate?.({ cron: "* * * * abc", prompt: "test" });
    expect(err).toContain("Invalid cron");
  });

  it("accepts valid cron expression", () => {
    const err = scheduleCronTool.validate?.({ cron: "*/5 * * * *", prompt: "test" });
    expect(err).toBeUndefined();
  });

  it("creates a schedule file on disk", async () => {
    const ctx: ToolContext = { cwd: tmpDir };
    const result = await scheduleCronTool.execute(
      { cron: "0 * * * *", prompt: "do something", recurring: true },
      ctx,
    );
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("Schedule created");
    expect(result.metadata?.jobId).toBeTruthy();

    // Verify file was written
    const jobId = result.metadata!.jobId as string;
    const filePath = join(tmpDir, ".slc", "schedules", `${jobId}.json`);
    const raw = await readFile(filePath, "utf-8");
    const record = JSON.parse(raw);
    expect(record.id).toBe(jobId);
    expect(record.cron).toBe("0 * * * *");
    expect(record.prompt).toBe("do something");
    expect(record.recurring).toBe(true);
    expect(record.createdAt).toBeTruthy();
  });

  it("defaults recurring to true", async () => {
    const ctx: ToolContext = { cwd: tmpDir };
    const result = await scheduleCronTool.execute(
      { cron: "30 9 * * 1-5", prompt: "check deploy" },
      ctx,
    );
    expect(result.isError).toBeUndefined();

    const jobId = result.metadata!.jobId as string;
    const raw = await readFile(join(tmpDir, ".slc", "schedules", `${jobId}.json`), "utf-8");
    const record = JSON.parse(raw);
    expect(record.recurring).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SkillTool
// ---------------------------------------------------------------------------

describe("SkillTool", () => {
  it("has correct name and security attributes", () => {
    expect(skillTool.name).toBe("Skill");
    expect(skillTool.security.readOnly).toBe(true);
    expect(skillTool.security.concurrencySafe).toBe(true);
    expect(skillTool.security.destructive).toBe(false);
  });

  it("returns error when skill not found", async () => {
    const ctx: ToolContext = { cwd: tmpDir };
    const result = await skillTool.execute({ skill: "nonexistent-skill-xyz" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Skill not found");
  });

  it("finds and executes a project skill", async () => {
    // Create a project skill
    const skillDir = join(tmpDir, ".slc", "skills", "hello");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: hello\ndescription: A test skill\n---\nHello from skill!`);

    const ctx: ToolContext = { cwd: tmpDir };
    const result = await skillTool.execute({ skill: "hello" }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("Hello from skill!");
  });

  it("appends args to skill output", async () => {
    const skillDir = join(tmpDir, ".slc", "skills", "echo");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: echo\n---\nEcho skill`);

    const ctx: ToolContext = { cwd: tmpDir };
    const result = await skillTool.execute({ skill: "echo", args: "extra data" }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("Echo skill");
    expect(result.output).toContain("Arguments: extra data");
  });
});

// ---------------------------------------------------------------------------
// AskUserTool
// ---------------------------------------------------------------------------

describe("AskUserTool", () => {
  it("has correct name and security attributes", () => {
    expect(askUserTool.name).toBe("AskUser");
    expect(askUserTool.security.readOnly).toBe(true);
    expect(askUserTool.security.concurrencySafe).toBe(true);
    expect(askUserTool.security.destructive).toBe(false);
  });

  it("returns error in non-interactive mode (no callback)", async () => {
    const ctx: ToolContext = { cwd: tmpDir };
    const result = await askUserTool.execute({ questions: ["What?"] }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("non-interactive");
  });

  it("uses the askUser callback to get answers", async () => {
    const answers: Record<string, string> = {
      "What is your name?": "Alice",
      "What is your quest?": "To find the grail",
    };
    const callback: AskUserCallback = async (questions: string[]) =>
      questions.map((q) => answers[q] ?? "unknown");

    const ctx = { cwd: tmpDir, askUser: callback };
    const result = await askUserTool.execute(
      { questions: ["What is your name?", "What is your quest?"] },
      ctx as unknown as ToolContext,
    );
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("Alice");
    expect(result.output).toContain("To find the grail");
    expect(result.output).toContain("Q: What is your name?");
    expect(result.output).toContain("A: Alice");
  });

  it("returns error when callback returns wrong number of answers", async () => {
    const callback: AskUserCallback = async () => ["only one"];
    const ctx = { cwd: tmpDir, askUser: callback };
    const result = await askUserTool.execute(
      { questions: ["Q1", "Q2"] },
      ctx as unknown as ToolContext,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Expected 2 answers");
  });

  it("returns isError=false when callback succeeds with placeholder answers", async () => {
    const callback: AskUserCallback = async (questions: string[]) =>
      questions.map((q) => `Placeholder answer for: ${q}`);
    const ctx = { cwd: tmpDir, askUser: callback };
    const result = await askUserTool.execute(
      { questions: ["What is your name?"] },
      ctx as unknown as ToolContext,
    );
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("Placeholder answer for: What is your name?");
  });

  it("runtime callback: real answer submitted via submitAskUserAnswers", async () => {
    const { createAskUserCallback, submitAskUserAnswers, getPendingQuestions, clearPendingQuestions } =
      await import("../../src/repl/ask-user-runtime.js");
    clearPendingQuestions();

    const callback = createAskUserCallback();
    const ctx = { cwd: tmpDir, askUser: callback };

    // Start the tool call — it will hang waiting for real answers
    const resultPromise = askUserTool.execute(
      { questions: ["What is your name?"] },
      ctx as unknown as ToolContext,
    );

    // Give the microtask a tick to queue the question
    await new Promise((r) => setTimeout(r, 10));

    // Verify question is pending
    const pending = getPendingQuestions();
    expect(pending).toHaveLength(1);
    expect(pending[0].questions).toEqual(["What is your name?"]);

    // Submit real answer
    submitAskUserAnswers(pending[0].id, ["Alice"]);

    // Now the tool should resolve with the real answer
    const result = await resultPromise;
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("Alice");
    expect(result.output).not.toContain("no answer collected");
  });

  it("runtime callback: cancel returns isError", async () => {
    const { createAskUserCallback, cancelAskUser, getPendingQuestions, clearPendingQuestions } =
      await import("../../src/repl/ask-user-runtime.js");
    clearPendingQuestions();

    const callback = createAskUserCallback();
    const ctx = { cwd: tmpDir, askUser: callback };

    const resultPromise = askUserTool.execute(
      { questions: ["Pick a color"] },
      ctx as unknown as ToolContext,
    );

    await new Promise((r) => setTimeout(r, 10));
    const pending = getPendingQuestions();
    expect(pending).toHaveLength(1);

    // Cancel the question
    cancelAskUser(pending[0].id);

    const result = await resultPromise;
    expect(result.isError).toBe(true);
    expect(result.output).toContain("cancelled");
  });
});

// ---------------------------------------------------------------------------
// PlanModeTools
// ---------------------------------------------------------------------------

describe("PlanModeTools", () => {
  it("EnterPlanMode has correct security attributes", () => {
    expect(enterPlanModeTool.name).toBe("EnterPlanMode");
    expect(enterPlanModeTool.security.readOnly).toBe(true);
    expect(enterPlanModeTool.security.concurrencySafe).toBe(true);
    expect(enterPlanModeTool.security.destructive).toBe(false);
  });

  it("ExitPlanMode has correct security attributes", () => {
    expect(exitPlanModeTool.name).toBe("ExitPlanMode");
    expect(exitPlanModeTool.security.readOnly).toBe(true);
    expect(exitPlanModeTool.security.concurrencySafe).toBe(true);
    expect(exitPlanModeTool.security.destructive).toBe(false);
  });

  it("enter plan mode sets state to active", async () => {
    const ctx: ToolContext = { cwd: tmpDir, permissionMode: "default" };
    const result = await enterPlanModeTool.execute({}, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("Entered plan mode");
    expect(result.contextModifier?.permissionMode).toBe("plan");

    const state = getPlanModeState();
    expect(state.active).toBe(true);
    expect(state.previousMode).toBe("default");
  });

  it("enter plan mode when already active returns info", async () => {
    // Enter once
    const ctx: ToolContext = { cwd: tmpDir, permissionMode: "default" };
    await enterPlanModeTool.execute({}, ctx);

    // Enter again
    const result = await enterPlanModeTool.execute({}, ctx);
    expect(result.output).toContain("Already in plan mode");
  });

  it("exit plan mode restores previous mode", async () => {
    const ctx: ToolContext = { cwd: tmpDir, permissionMode: "acceptEdits" };
    await enterPlanModeTool.execute({}, ctx);

    const result = await exitPlanModeTool.execute({}, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("Exited plan mode");
    expect(result.contextModifier?.permissionMode).toBe("acceptEdits");

    const state = getPlanModeState();
    expect(state.active).toBe(false);
  });

  it("exit plan mode when not active returns info", async () => {
    const ctx: ToolContext = { cwd: tmpDir };
    const result = await exitPlanModeTool.execute({}, ctx);
    expect(result.output).toContain("Not in plan mode");
  });

  it("enter -> exit -> enter cycle works", async () => {
    const ctx: ToolContext = { cwd: tmpDir, permissionMode: "default" };

    await enterPlanModeTool.execute({}, ctx);
    expect(getPlanModeState().active).toBe(true);

    await exitPlanModeTool.execute({}, ctx);
    expect(getPlanModeState().active).toBe(false);

    await enterPlanModeTool.execute({}, ctx);
    expect(getPlanModeState().active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EnterWorktreeTool / ExitWorktreeTool (without real git)
// ---------------------------------------------------------------------------

describe("EnterWorktreeTool", () => {
  it("has correct security attributes", () => {
    expect(enterWorktreeTool.name).toBe("EnterWorktree");
    expect(enterWorktreeTool.security.readOnly).toBe(false);
    expect(enterWorktreeTool.security.concurrencySafe).toBe(false);
    expect(enterWorktreeTool.security.destructive).toBe(false);
  });

  it("validates that name or path is required", () => {
    const err = enterWorktreeTool.validate?.({});
    expect(err).toContain("name or path");
  });

  it("validates that name and path are mutually exclusive", () => {
    const err = enterWorktreeTool.validate?.({ name: "x", path: "/y" });
    expect(err).toContain("not both");
  });

  it("switches to existing worktree path within .slc/worktrees", async () => {
    const worktreeDir = join(tmpDir, ".slc", "worktrees", "my-worktree");
    await mkdir(worktreeDir, { recursive: true });
    await writeFile(join(worktreeDir, "README.md"), "content");

    const ctx: ToolContext = { cwd: tmpDir };
    const result = await enterWorktreeTool.execute({ path: ".slc/worktrees/my-worktree" }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("Switched to existing worktree");
    expect(result.contextModifier?.cwd).toBe(worktreeDir);
  });

  it("rejects path outside .slc/worktrees", async () => {
    const outsideDir = join(tmpDir, "outside-worktree");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "file.txt"), "content");

    const ctx: ToolContext = { cwd: tmpDir };
    const result = await enterWorktreeTool.execute({ path: outsideDir }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("must be within");
  });
});

describe("ExitWorktreeTool", () => {
  it("has correct security attributes", () => {
    expect(exitWorktreeTool.name).toBe("ExitWorktree");
    expect(exitWorktreeTool.security.readOnly).toBe(false);
    expect(exitWorktreeTool.security.concurrencySafe).toBe(false);
    expect(exitWorktreeTool.security.destructive).toBe(false);
  });

  it("validates action", () => {
    const err = exitWorktreeTool.validate?.({ action: "invalid" });
    expect(err).toContain("keep");
  });

  it("keep action returns success", async () => {
    const ctx: ToolContext = { cwd: tmpDir };
    const result = await exitWorktreeTool.execute({ action: "keep" }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("kept");
    expect(result.contextModifier?.worktreePath).toBeUndefined();
  });

  it("remove action without git fails gracefully", async () => {
    // In a non-git directory, remove will fail
    const ctx: ToolContext = { cwd: tmpDir };
    const result = await exitWorktreeTool.execute({ action: "remove", worktree_path: "/tmp/fake-wt-xyz" }, ctx);
    // Should return error since it can't use git worktree remove on a non-worktree
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createBuiltinRegistry includes all Phase 4 tools
// ---------------------------------------------------------------------------

describe("createBuiltinRegistry", () => {
  it("registers 21 builtin tools", () => {
    const registry = createBuiltinRegistry();
    const names = registry.list().map((t: Tool) => t.name);
    expect(names).toHaveLength(21);
  });

  it("includes all Phase 4 tools", () => {
    const registry = createBuiltinRegistry();
    const phase4Names = [
      "WebFetch",
      "WebSearch",
      "NotebookEdit",
      "ScheduleCron",
      "Skill",
      "AskUser",
      "EnterPlanMode",
      "ExitPlanMode",
      "EnterWorktree",
      "ExitWorktree",
    ];
    for (const name of phase4Names) {
      expect(registry.has(name)).toBe(true);
    }
  });

  it("includes all Phase 2 and 3 tools", () => {
    const registry = createBuiltinRegistry();
    const earlyNames = [
      "FileRead",
      "FileWrite",
      "FileEdit",
      "Glob",
      "Grep",
      "Bash",
      "Agent",
      "TaskCreate",
      "TaskGet",
      "TaskList",
      "TaskUpdate",
    ];
    for (const name of earlyNames) {
      expect(registry.has(name)).toBe(true);
    }
  });
});
