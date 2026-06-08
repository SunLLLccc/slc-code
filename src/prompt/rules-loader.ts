// Rules loader — loads SLC.md and .slc/rules/*.md with trust ordering

import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

/**
 * Load rules from project SLC.md and .slc/rules/*.md.
 * Trust order (highest priority first):
 * 1. Project .slc/rules/*.md (sorted alphabetically)
 * 2. Project SLC.md
 * 3. User ~/.slc/rules/*.md (sorted alphabetically)
 * 4. User ~/.slc/SLC.md
 *
 * Returns an array of rule strings (file contents), in trust order.
 */
export async function loadRules(options: {
  projectRoot: string;
  userConfigDir?: string;
}): Promise<string[]> {
  const { projectRoot, userConfigDir } = options;
  const rules: string[] = [];

  // 1. Project .slc/rules/*.md (highest priority)
  const projectRulesDir = join(projectRoot, ".slc", "rules");
  const projectRules = await loadMarkdownFiles(projectRulesDir);
  rules.push(...projectRules);

  // 2. Project SLC.md
  const projectSlcMd = join(projectRoot, "SLC.md");
  const projectSlc = await loadSingleFile(projectSlcMd);
  if (projectSlc) rules.push(projectSlc);

  // 3. User ~/.slc/rules/*.md
  if (userConfigDir) {
    const userRulesDir = join(userConfigDir, "rules");
    const userRules = await loadMarkdownFiles(userRulesDir);
    rules.push(...userRules);

    // 4. User ~/.slc/SLC.md
    const userSlcMd = join(userConfigDir, "SLC.md");
    const userSlc = await loadSingleFile(userSlcMd);
    if (userSlc) rules.push(userSlc);
  }

  return rules;
}

/**
 * Load all .md files from a directory, sorted alphabetically.
 */
async function loadMarkdownFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];

  try {
    const entries = await readdir(dir);
    const mdFiles = entries
      .filter((f) => f.endsWith(".md"))
      .sort();

    const results: string[] = [];
    for (const file of mdFiles) {
      const content = await loadSingleFile(join(dir, file));
      if (content) results.push(content);
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Load a single file, returning null if it doesn't exist or can't be read.
 */
async function loadSingleFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}
