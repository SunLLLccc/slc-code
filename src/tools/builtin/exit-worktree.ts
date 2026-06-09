// ExitWorktreeTool — exit a git worktree (keep or remove)

import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";

const execFileAsync = promisify(execFile);

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

export const exitWorktreeTool: Tool = buildTool({
  name: "ExitWorktree",
  description: "Exit a git worktree — keep or remove",
  security: {
    readOnly: false,
    concurrencySafe: false,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["keep", "remove"],
          description: "Whether to keep or remove the worktree",
        },
        discard_changes: {
          type: "boolean",
          description: "Discard uncommitted changes on remove",
        },
        worktree_path: {
          type: "string",
          description: "Path to the worktree (defaults to context worktree metadata)",
        },
      },
      required: ["action"],
    },
  },
  validate(input: ToolInput): string | undefined {
    const action = input.action as string;
    if (action !== "keep" && action !== "remove") {
      return `action must be "keep" or "remove", got "${action}"`;
    }
    return undefined;
  },
  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const action = input.action as string;
    const discardChanges = (input.discard_changes as boolean) ?? false;
    const worktreePath = (input.worktree_path as string) ?? context.cwd;

    // Determine the original project directory to restore.
    // previousCwd is set by EnterWorktree's contextModifier and propagated
    // through query.ts into toolContext. Fall back to context.cwd if missing.
    const originalCwd = (context as unknown as Record<string, unknown>).previousCwd as string ?? context.cwd;

    if (action === "keep") {
      return {
        output: `Worktree kept at: ${worktreePath}. Restored to: ${originalCwd}`,
        contextModifier: { cwd: originalCwd, worktreePath: undefined, worktreeName: undefined, previousCwd: undefined },
      };
    }

    // action === "remove"
    const forceFlag = discardChanges ? "--force" : "";

    try {
      const args = ["worktree", "remove"];
      if (forceFlag) args.push(forceFlag);
      args.push(worktreePath);
      await runGit(args, context.cwd);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (discardChanges) {
        try {
          await rm(worktreePath, { recursive: true, force: true });
          try {
            await runGit(["worktree", "prune"], context.cwd);
          } catch {
            // prune failure is non-fatal
          }
        } catch (rmErr) {
          return {
            output: `Failed to remove worktree: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`,
            isError: true,
          };
        }
      } else {
        return {
          output: `Failed to remove worktree: ${message}. Use discard_changes: true to force removal.`,
          isError: true,
        };
      }
    }

    return {
      output: `Worktree removed: ${worktreePath}. Restored to: ${originalCwd}`,
      contextModifier: { cwd: originalCwd, worktreePath: undefined, worktreeName: undefined, previousCwd: undefined },
    };
  },
});
