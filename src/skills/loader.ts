// Skill loader — reads SKILL.md files and parses frontmatter

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillMeta } from "./discovery.js";

export interface Skill {
  meta: SkillMeta;
  content: string; // SKILL.md body (after frontmatter)
}

/**
 * Parse simple YAML frontmatter from a markdown file.
 * Expects content between `---` delimiters with `key: value` pairs.
 */
export function parseFrontmatter(content: string): {
  metadata: Record<string, unknown>;
  body: string;
} {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) {
    return { metadata: {}, body: trimmed };
  }

  const closingIndex = trimmed.indexOf("\n---", 3);
  if (closingIndex === -1) {
    return { metadata: {}, body: trimmed };
  }

  const frontmatterBlock = trimmed.slice(3, closingIndex).trim();
  const body = trimmed.slice(closingIndex + 4).trim();

  const metadata: Record<string, unknown> = {};
  for (const line of frontmatterBlock.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (!key) continue;
    // Strip surrounding quotes
    metadata[key] = value.replace(/^["']|["']$/g, "");
  }

  return { metadata, body };
}

/**
 * Load a skill from a directory containing a SKILL.md file.
 * Returns null if SKILL.md doesn't exist or can't be read.
 */
export async function loadSkill(
  skillDir: string,
): Promise<Skill | null> {
  const skillPath = join(skillDir, "SKILL.md");
  let content: string;
  try {
    content = await readFile(skillPath, "utf-8");
  } catch {
    return null;
  }

  const { metadata, body } = parseFrontmatter(content);

  const meta: SkillMeta = {
    name: String(metadata.name ?? skillDir.split("/").pop() ?? "unknown"),
    description: String(metadata.description ?? ""),
    source: "project",
    path: skillDir,
    ...(metadata.paths
      ? { paths: String(metadata.paths).split(",").map((p) => p.trim()) }
      : {}),
  };

  return { meta, content: body };
}
