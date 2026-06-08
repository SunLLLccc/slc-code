// Skill execution — returns skill content with optional shell interpolation

import type { Skill } from "./loader.js";
import { execFileSync } from "node:child_process";

/**
 * Execute a skill and return its content.
 *
 * For trusted sources (project/user), shell commands in backticks are interpolated.
 * For untrusted sources (MCP, bundled without trust), content is returned as-is.
 *
 * Shell interpolation: `!command` executes the command and replaces with output.
 * Only enabled when skill.meta.allowShellInterpolation === true.
 */
export async function executeSkill(
  skill: Skill,
  context: { cwd: string },
): Promise<string> {
  const content = skill.content;

  // Only interpolate for trusted sources
  if (!skill.meta.allowShellInterpolation) {
    return content;
  }

  // Shell interpolation: replace `!command` patterns
  return interpolateShellCommands(content, context.cwd);
}

/**
 * Replace `!command` patterns in skill content with command output.
 * Only processes backtick-wrapped commands: `!ls -la`
 */
function interpolateShellCommands(content: string, cwd: string): string {
  // Match `!command` patterns (backtick + exclamation mark + command)
  return content.replace(/`!([^`]+)`/g, (_match, command: string) => {
    try {
      const output = execFileSync("bash", ["-c", command.trim()], {
        encoding: "utf-8",
        cwd,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      return output.trim();
    } catch {
      // Command failed — return original pattern
      return _match;
    }
  });
}
