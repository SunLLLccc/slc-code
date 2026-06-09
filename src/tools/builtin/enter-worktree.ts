// EnterWorktreeTool — real git worktree management

import { execFile } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Worktree directory
// ---------------------------------------------------------------------------

const WORKTREE_BASE = ".slc/worktrees";

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("git", args, { cwd, timeout: 15_000 });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(e.stderr ?? e.message ?? "git command failed");
  }
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const enterWorktreeTool: Tool = buildTool({
  name: "EnterWorktree",
  description: "Enter a git worktree — create new or switch to existing",
  security: {
    readOnly: false,
    concurrencySafe: false,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for a new worktree" },
        path: { type: "string", description: "Path to an existing worktree" },
      },
    },
  },
  validate(input: ToolInput): string | undefined {
    const name = input.name as string | undefined;
    const path = input.path as string | undefined;
    if (!name && !path) {
      return "Either name or path must be provided";
    }
    if (name && path) {
      return "Provide either name or path, not both";
    }
    return undefined;
  },
  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const worktreeBase = join(context.cwd, WORKTREE_BASE);
    const existingPath = input.path as string | undefined;

    if (existingPath) {
      // Switch to an existing worktree — must be within worktree base
      const resolved = resolve(context.cwd, existingPath);
      const resolvedBase = resolve(context.cwd, WORKTREE_BASE);

      // Security: path must be within SLC-managed worktree base
      if (!resolved.startsWith(resolvedBase + "/") && resolved !== resolvedBase) {
        return {
          output: `Worktree path must be within ${WORKTREE_BASE}: ${resolved}`,
          isError: true,
        };
      }

      try {
        const entries = await readdir(resolved);
        if (entries.length === 0) {
          return { output: `Worktree directory is empty: ${resolved}`, isError: true };
        }
      } catch {
        return { output: `Worktree path does not exist: ${resolved}`, isError: true };
      }

      return {
        output: `Switched to existing worktree at: ${resolved}`,
        contextModifier: { cwd: resolved, worktreePath: resolved, previousCwd: context.cwd },
      };
    }

    // Create a new worktree
    const name = (input.name as string).replace(/[^a-zA-Z0-9._-]/g, "-");
    const worktreePath = join(worktreeBase, name);

    try {
      await mkdir(worktreeBase, { recursive: true });
    } catch {
      // directory may already exist
    }

    // Check if worktree already exists at this path
    try {
      await readdir(worktreePath);
      return {
        output: `Worktree already exists at: ${worktreePath}. Use path parameter to switch to it.`,
        isError: true,
      };
    } catch {
      // Path doesn't exist, good — proceed to create
    }

    try {
      await runGit(["worktree", "add", worktreePath, "-b", name], context.cwd);
    } catch (err) {
      return {
        output: `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    return {
      output: `Created and entered worktree "${name}" at: ${worktreePath}`,
      contextModifier: { cwd: worktreePath, worktreePath, worktreeName: name, previousCwd: context.cwd },
    };
  },
});
