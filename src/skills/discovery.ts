// Skill discovery — scans directories for SKILL.md-based skills

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadSkill } from "./loader.js";

export interface SkillMeta {
  name: string;
  description: string;
  source: "user" | "project" | "bundled";
  path: string;
  paths?: string[];
}

/**
 * Discover all skills from project and user directories.
 * Returns sorted: project > user > bundled.
 */
export async function discoverSkills(options: {
  projectRoot: string;
  userConfigDir: string;
}): Promise<SkillMeta[]> {
  const { projectRoot, userConfigDir } = options;

  const projectDir = join(projectRoot, ".slc", "skills");
  const userDir = join(userConfigDir, "skills");

  const [projectSkills, userSkills] = await Promise.all([
    scanSkillDir(projectDir, "project"),
    scanSkillDir(userDir, "user"),
  ]);

  // project > user > bundled (bundled is empty for now)
  return [...projectSkills, ...userSkills];
}

/** Scan a directory for subdirectories containing SKILL.md files. */
async function scanSkillDir(
  dir: string,
  source: "project" | "user",
): Promise<SkillMeta[]> {
  let entries: string[];
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }

  const skills: SkillMeta[] = [];
  for (const name of entries) {
    const skillDir = join(dir, name);
    const skill = await loadSkill(skillDir);
    if (skill) {
      skill.meta.source = source;
      skills.push(skill.meta);
    }
  }

  return skills;
}
