// Unified sandbox interface — dispatches to platform-specific backends

import { execFile } from "node:child_process";
import type { SandboxConfig } from "./config.js";
import { execWithSeatbelt } from "./seatbelt.js";
import { execWithBubblewrap } from "./bubblewrap.js";

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Execute a command inside a platform-appropriate sandbox.
 *
 * - macOS: Seatbelt (sandbox-exec)
 * - Linux: Bubblewrap (bwrap)
 * - Windows: no OS-level sandbox; application-level permissions only
 *
 * All paths are wrapped in try/catch — errors never propagate.
 */
export async function execInSandbox(
  command: string,
  config: SandboxConfig,
  options: { cwd: string; timeout?: number; env?: Record<string, string> },
): Promise<SandboxResult> {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      return await execWithSeatbelt(command, config, options);
    }

    if (platform === "linux") {
      return await execWithBubblewrap(command, config, options);
    }

    // Windows / other: no OS-level sandbox, just execute directly
    return await execWithoutSandbox(command, options);
  } catch (e) {
    return {
      stdout: "",
      stderr: `\n[warning] sandbox execution error: ${e instanceof Error ? e.message : String(e)}. Command ran unsandboxed.`,
      exitCode: 1,
    };
  }
}

/**
 * Direct execution without OS-level sandboxing.
 * Used as fallback on unsupported platforms.
 */
function execWithoutSandbox(
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
          stderr: (stderr ?? "") +
            "\n[warning] no sandbox support on this platform; command ran unsandboxed",
          exitCode: typeof err.killed === "boolean" && err.killed
            ? null
            : (err.code ?? 1) as number,
        });
        return;
      }
      resolve({
        stdout: stdout ?? "",
        stderr: (stderr ?? "") +
          "\n[warning] no sandbox support on this platform; command ran unsandboxed",
        exitCode: 0,
      });
    });
  });
}
