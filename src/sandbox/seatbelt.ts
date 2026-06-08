// macOS Seatbelt (sandbox-exec) wrapper

import { execFile } from "node:child_process";
import type { SandboxConfig } from "./config.js";
import type { SandboxResult } from "./sandbox.js";

/**
 * Execute a command inside the macOS Seatbelt sandbox.
 * Falls back to unsandboxed execution if sandbox-exec is not available or not usable.
 */
export function execWithSeatbelt(
  command: string,
  config: SandboxConfig,
  options: { cwd: string; timeout?: number; env?: Record<string, string> },
): Promise<SandboxResult> {
  const profile = buildSeatbeltProfile(config);
  const execOpts = {
    cwd: options.cwd,
    timeout: options.timeout,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, ...options.env } as Record<string, string>,
  };

  return new Promise<SandboxResult>((resolve) => {
    execFile(
      "sandbox-exec",
      ["-p", profile, "bash", "-c", command],
      execOpts,
      (err, stdout, stderr) => {
        if (err) {
          if (isSandboxUnavailable(err)) {
            return execUnsandboxed(command, options).then(resolve);
          }
          // sandbox-exec ran but the sandboxed command itself failed
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode: typeof err.killed === "boolean" && err.killed ? null : 1,
          });
          return;
        }
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: 0,
        });
      },
    );
  });
}

/**
 * Check if a sandbox runtime error indicates the runtime is unavailable.
 * Covers: not found (ENOENT), permission denied (EPERM),
 * "Operation not permitted" from sandbox_apply, and common patterns.
 */
function isSandboxUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // ENOENT: command not found
  if ("code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") return true;
  // EPERM: permission denied to use sandbox
  if ("code" in err && (err as NodeJS.ErrnoException).code === "EPERM") return true;
  // Common patterns from sandbox runtime failures
  if (msg.includes("operation not permitted")) return true;
  if (msg.includes("permission denied")) return true;
  if (msg.includes("sandbox_apply")) return true;
  if (msg.includes("not found")) return true;
  if (msg.includes("enoent")) return true;
  return false;
}

function buildSeatbeltProfile(config: SandboxConfig): string {
  const lines: string[] = [
    "(version 1)",
    "(deny default)",
    "(allow process-exec)",
    "(allow file-read*)",
  ];

  for (const path of config.allowWrite) {
    lines.push(`(allow file-write* (subpath "${path}"))`);
  }

  for (const path of config.denyWrite) {
    lines.push(`(deny file-write* (subpath "${path}"))`);
  }

  if (!config.allowNetwork) {
    lines.push("(deny network*)");
  }

  return lines.join("\n");
}

/**
 * Fallback: run without sandbox, appending a warning to stderr.
 */
function execUnsandboxed(
  command: string,
  options: { cwd: string; timeout?: number; env?: Record<string, string> },
): Promise<SandboxResult> {
  const execOpts = {
    cwd: options.cwd,
    timeout: options.timeout,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, ...options.env } as Record<string, string>,
  };

  return new Promise<SandboxResult>((resolve) => {
    execFile("bash", ["-c", command], execOpts, (err, stdout, stderr) => {
      if (err) {
        resolve({
          stdout: stdout ?? "",
          stderr:
            (stderr ?? "") +
            "\n[warning] sandbox-exec not available; command ran unsandboxed",
          exitCode: typeof err.killed === "boolean" && err.killed ? null : (err.code ?? 1) as number,
        });
        return;
      }
      resolve({
        stdout: stdout ?? "",
        stderr:
          (stderr ?? "") +
          "\n[warning] sandbox-exec not available; command ran unsandboxed",
        exitCode: 0,
      });
    });
  });
}
