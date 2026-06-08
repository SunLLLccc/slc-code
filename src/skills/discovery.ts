// Skill discovery — scans directories for SKILL.md-based skills

import { readdir, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { loadSkill } from "./loader.js";

export interface SkillMeta {
  name: string;
  description: string;
  source: "user" | "project" | "bundled" | "mcp";
  path: string;
  paths?: string[];
  /** Whether shell interpolation is allowed for this skill */
  allowShellInterpolation?: boolean;
}

/** In-memory cache for discovered skills — keyed by full input combination */
let cachedSkills: SkillMeta[] | null = null;
let cacheKey: string | null = null;

/**
 * Discover all skills from project, user, and bundled directories.
 * Returns sorted: project > user > bundled.
 * Uses realpath dedup and memoize cache per cwd.
 */
export async function discoverSkills(options: {
  projectRoot: string;
  userConfigDir: string;
  bundledDir?: string;
  cwd?: string;
  /** Force refresh, ignore cache */
  force?: boolean;
}): Promise<SkillMeta[]> {
  const { projectRoot, userConfigDir, bundledDir, cwd, force } = options;
  // Cache key includes all inputs that affect results
  const key = `${projectRoot}|${userConfigDir}|${bundledDir ?? ""}|${cwd ?? ""}`;

  // Memoize cache
  if (!force && cachedSkills && cacheKey === key) {
    return cachedSkills;
  }

  const projectDir = join(projectRoot, ".slc", "skills");
  const userDir = join(userConfigDir, "skills");

  const [projectSkills, userSkills, bundledSkills] = await Promise.all([
    scanSkillDir(projectDir, "project"),
    scanSkillDir(userDir, "user"),
    bundledDir ? scanSkillDir(bundledDir, "bundled") : Promise.resolve([]),
  ]);

  // Dedup by realpath — project > user > bundled priority
  const seen = new Set<string>();
  const result: SkillMeta[] = [];

  for (const skill of [...projectSkills, ...userSkills, ...bundledSkills]) {
    try {
      const real = await realpath(skill.path);
      if (seen.has(real)) continue;
      seen.add(real);
    } catch {
      // If realpath fails, use path as-is
      if (seen.has(skill.path)) continue;
      seen.add(skill.path);
    }
    result.push(skill);
  }

  cachedSkills = result;
  cacheKey = key;
  return result;
}

/**
 * Check if a skill is active for the given file path.
 * Matches skill.paths patterns against the relative path.
 * Supports basic glob: * matches any segment, ** matches any depth.
 */
export function isSkillActiveForPath(skill: SkillMeta, filePath: string, projectRoot: string): boolean {
  // No paths restriction → always active
  if (!skill.paths || skill.paths.length === 0) return true;

  const relPath = relative(projectRoot, filePath);

  for (const pattern of skill.paths) {
    if (matchGlobPattern(pattern, relPath)) return true;
  }

  return false;
}

/**
 * Filter skills to only those active for the given path.
 */
export function filterActiveSkills(
  skills: SkillMeta[],
  filePath: string,
  projectRoot: string,
): SkillMeta[] {
  return skills.filter((s) => isSkillActiveForPath(s, filePath, projectRoot));
}

/**
 * Basic glob pattern matching.
 * Supports: * (any segment), ** (any depth), literal matching.
 */
function matchGlobPattern(pattern: string, path: string): boolean {
  const p = pattern.replace(/\\/g, "/");
  const f = path.replace(/\\/g, "/");

  if (p === "**") return true;

  // Split into segments and match recursively
  return matchSegments(p.split("/"), f.split("/"));
}

function matchSegments(patternSegs: string[], pathSegs: string[]): boolean {
  let pi = 0;
  let fi = 0;

  while (pi < patternSegs.length && fi < pathSegs.length) {
    const pat = patternSegs[pi]!;

    if (pat === "**") {
      // ** matches zero or more path segments
      pi++;
      if (pi >= patternSegs.length) return true; // trailing ** matches everything

      // Try matching remaining pattern against every possible suffix
      while (fi <= pathSegs.length) {
        if (matchSegments(patternSegs.slice(pi), pathSegs.slice(fi))) {
          return true;
        }
        fi++;
      }
      return false;
    }

    if (!matchSegment(pat, pathSegs[fi]!)) return false;
    pi++;
    fi++;
  }

  // Both exhausted, or trailing ** consumed remaining
  return pi >= patternSegs.length && fi >= pathSegs.length;
}

function matchSegment(pattern: string, segment: string): boolean {
  if (pattern === "*") return true;
  if (pattern === segment) return true;

  // Simple wildcard within segment: *.ts matches foo.ts
  if (pattern.includes("*")) {
    const regex = "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
    return new RegExp(regex).test(segment);
  }

  return false;
}

/** Scan a directory for subdirectories containing SKILL.md files. */
async function scanSkillDir(
  dir: string,
  source: "project" | "user" | "bundled",
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
      // project/user/bundled skills trust shell interpolation by default
      skill.meta.allowShellInterpolation = source !== "bundled";
      skills.push(skill.meta);
    }
  }

  return skills;
}

/** Clear the discovery cache (for testing). */
export function clearDiscoveryCache(): void {
  cachedSkills = null;
  cacheKey = null;
}
