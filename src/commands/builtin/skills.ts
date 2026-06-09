// /skills — list available skills via P11 discovery

import type { Command, CommandContext } from "../registry.js";
import { discoverSkills, clearDiscoveryCache, type SkillMeta } from "../../skills/discovery.js";

function getUserConfigDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return `${home}/.slc`;
}

export const skillsCommand: Command = {
  name: "skills",
  description: "List available skills",
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const cwd = (context.config?.cwd as string) ?? process.cwd();
    const force = args.trim() === "--force" || args.trim() === "-f";

    if (force) {
      clearDiscoveryCache();
    }

    try {
      const skills = await discoverSkills({
        projectRoot: cwd,
        userConfigDir: getUserConfigDir(),
        cwd,
        force,
      });

      if (skills.length === 0) {
        return "No skills found. Create a skill in .slc/skills/<name>/SKILL.md or ~/.slc/skills/<name>/SKILL.md.";
      }

      const lines = [`Skills (${skills.length}):\n`];

      for (const skill of skills) {
        const sourceTag = `[${skill.source}]`;
        const interpTag = skill.allowShellInterpolation ? " (shell)" : "";
        const desc = skill.description ? ` — ${skill.description}` : "";
        lines.push(`  ${skill.name} ${sourceTag}${interpTag}${desc}`);
      }

      return lines.join("\n");
    } catch (err) {
      return `Error discovering skills: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
