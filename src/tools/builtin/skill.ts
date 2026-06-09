// SkillTool — real skill execution via P11 discovery/loader/executor

import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { discoverSkills } from "../../skills/discovery.js";
import { loadSkill } from "../../skills/loader.js";
import { executeSkill } from "../../skills/executor.js";
import { sanitizeUnicode } from "../../security/unicode.js";

// ---------------------------------------------------------------------------
// Default paths — callers can override via context metadata
// ---------------------------------------------------------------------------

function getUserConfigDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return `${home}/.slc`;
}

function getBundledDir(): string | undefined {
  // Bundled skills are optional — if the dir doesn't exist, discovery skips it
  return undefined;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const skillTool: Tool = buildTool({
  name: "Skill",
  description: "Execute a skill by name",
  security: {
    readOnly: true,
    concurrencySafe: true,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        skill: { type: "string", description: "Name of the skill" },
        args: { type: "string", description: "Optional arguments (appended to skill content)" },
      },
      required: ["skill"],
    },
  },
  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const skillName = input.skill as string;
    const args = (input.args as string) ?? "";

    // Discover all skills
    const skills = await discoverSkills({
      projectRoot: context.cwd,
      userConfigDir: getUserConfigDir(),
      bundledDir: getBundledDir(),
      cwd: context.cwd,
    });

    // Find by name
    const match = skills.find((s) => s.name === skillName);
    if (!match) {
      const available = skills.map((s) => s.name).join(", ") || "none";
      return {
        output: sanitizeUnicode(
          `Skill not found: "${skillName}". Available skills: ${available}`,
        ),
        isError: true,
      };
    }

    // Load the skill content
    const skill = await loadSkill(match.path);
    if (!skill) {
      return {
        output: `Skill directory exists but SKILL.md could not be loaded: ${match.path}`,
        isError: true,
      };
    }

    // Execute — interpolates shell for trusted sources, sanitizes output
    let content = await executeSkill(skill, { cwd: context.cwd });

    // Append args if provided
    if (args) {
      content += `\n\nArguments: ${args}`;
    }

    return { output: sanitizeUnicode(content) };
  },
});
