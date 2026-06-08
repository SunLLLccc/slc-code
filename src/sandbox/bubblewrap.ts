// Linux Bubblewrap (bwrap) wrapper

import { execFile } from "node:child_process";
import type { SandboxConfig } from "./config.js";
import type { SandboxResult } from "./sandbox.js";

/**
 * Execute a command inside a Bubblewrap sandbox.
 * Falls back to unsandboxed execution if bwrap is not available or not usable.
 */
export function execWithBubblewrap(
  command: string,
  config: SandboxConfig,
  options: { cwd: string; timeout?: number; env?: Record<string, string> },
): Promise<SandboxResult> {
  const args = buildBwrapArgs(command, config);
  const execOpts = {
    cwd: options.cwd,
    timeout: options.timeout,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, ...options.env } as Record<string, string>,
  };

  return new Promise<SandboxResult>((resolve) => {
    execFile("bwrap", args, execOpts, (err, stdout, stderr) => {
      if (err) {
        // bwrap not found or not usable → fallback to unsandboxed
        if (isSandboxUnavailable(err)) {
          return execUnsandboxed(command, options).then(resolve);
        }
        // bwrap ran but the sandboxed command itself failed
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
    });
  });
}

/**
 * Check if a sandbox runtime error indicates the runtime is unavailable.
 * Covers: not found (ENOENT), permission denied (EPERM), namespace errors,
 * and common "Operation not permitted" patterns from containerized environments.
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
  if (msg.includes("not found")) return true;
  if (msg.includes("enoent")) return true;
  if (msg.includes("namespace")) return true;
  if (msg.includes("unshare")) return true;
  return false;
}

function buildBwrapArgs(command: string, config: SandboxConfig): string[] {
  const args: string[] = [];

  if (!config.allowNetwork) {
    args.push("--unshare-net");
  }

  // Full filesystem read access
  args.push("--bind", "/", "/");
  // Device access
  args.push("--dev", "/dev");

  // Write-allowed paths: bind as read-write
  for (const path of config.allowWrite) {
    args.push("--bind-try", path, path);
  }

  // Write-denied paths: mount read-only (overrides write-allowed)
  for (const path of config.denyWrite) {
    args.push("--ro-bind-try", path, path);
  }

  // Execute the command
  args.push("--", "bash", "-c", command);

  return args;
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
            "\n[warning] bwrap not available; command ran unsandboxed",
          exitCode: typeof err.killed === "boolean" && err.killed ? null : (err.code ?? 1) as number,
        });
        return;
      }
      resolve({
        stdout: stdout ?? "",
        stderr:
          (stderr ?? "") +
          "\n[warning] bwrap not available; command ran unsandboxed",
        exitCode: 0,
      });
    });
  });
}
