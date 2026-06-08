// BashTool — execute shell commands with optional sandboxing

import { execFile } from "node:child_process";
import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { resolveToolPath } from "../../permissions/checker.js";
import { buildSandboxConfig } from "../../sandbox/config.js";
import { execInSandbox } from "../../sandbox/sandbox.js";
import { cleanupGitEscape } from "../../sandbox/git-cleanup.js";

export const bashTool: Tool = buildTool({
  name: "Bash",
  description: "Execute shell commands",
  security: {
    readOnly: false,
    concurrencySafe: false,
    destructive: true,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute",
        },
        timeout: {
          type: "integer",
          description: "Timeout in milliseconds",
          default: 120000,
        },
        cwd: {
          type: "string",
          description: "Working directory override",
        },
        sandbox: {
          type: "boolean",
          description: "Run in sandbox",
          default: false,
        },
      },
      required: ["command"],
    },
  },
  validate(input: ToolInput): string | undefined {
    const command = input.command;
    if (typeof command !== "string" || command.trim() === "") {
      return "command must be a non-empty string";
    }
    return undefined;
  },
  async execute(
    input: ToolInput,
    context: ToolContext,
  ): Promise<ToolOutput> {
    const command = input.command as string;
    const timeout = (input.timeout as number | undefined) ?? 120000;
    const rawCwd = input.cwd as string | undefined;
    const sandbox = (input.sandbox as boolean | undefined) ?? false;

    // 1. Resolve cwd
    const cwd = rawCwd
      ? resolveToolPath(rawCwd, context.cwd)
      : context.cwd;

    // 2. Sandbox path
    if (sandbox) {
      try {
        const config = buildSandboxConfig({
          projectRoot: cwd,
          settingsPath: resolveToolPath(".slc", cwd),
        });
        const result = await execInSandbox(command, config, { cwd, timeout });
        const output = result.stdout + result.stderr;
        // Git bare repo escape cleanup — PRD 8.2
        const cleanup = cleanupGitEscape(cwd);
        if (cleanup.found) {
          const warning = `\n[git-cleanup] detected suspicious git config residuals`;
          if (result.exitCode !== 0) {
            return { output: output + warning, isError: true };
          }
          return { output: output + warning };
        }
        if (result.exitCode !== 0) {
          return { output, isError: true };
        }
        return { output };
      } catch (e) {
        return {
          output: `Sandbox error: ${e instanceof Error ? e.message : String(e)}`,
          isError: true,
        };
      }
    }

    // 3. Unsandboxed execution
    const execOpts = {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env as Record<string, string>,
    };

    return new Promise<ToolOutput>((resolve) => {
      execFile("bash", ["-c", command], execOpts, (err, stdout, stderr) => {
        if (err) {
          // Timeout detection
          if ("killed" in err && err.killed) {
            resolve({ output: "Command timed out", isError: true });
            return;
          }
          const combined = (stdout ?? "") + (stderr ?? "");
          resolve({
            output: combined
              ? `Command failed: ${combined}`
              : `Command failed: ${err.message}`,
            isError: true,
          });
          return;
        }
        resolve({ output: (stdout ?? "") + (stderr ?? "") });
      });
    });
  },
});
