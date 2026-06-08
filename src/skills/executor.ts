// Skill execution — returns skill content for injection into prompts

import type { Skill } from "./loader.js";

/**
 * Execute a skill and return its content.
 * For P11: returns the skill content as-is.
 * Future: shell interpolation for trusted sources.
 */
export async function executeSkill(
  skill: Skill,
  _context: { cwd: string },
): Promise<string> {
  return skill.content;
}
