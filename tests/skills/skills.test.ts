import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverSkills,
  isSkillActiveForPath,
  filterActiveSkills,
  clearDiscoveryCache,
  type SkillMeta,
} from "../../src/skills/discovery.js";
import { loadSkill, parseFrontmatter } from "../../src/skills/loader.js";
import { executeSkill } from "../../src/skills/executor.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "skills-test-"));
  clearDiscoveryCache();
});

afterEach(async () => {
  clearDiscoveryCache();
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with body", () => {
    const input = `---
name: my-skill
description: A test skill
---
Body content here`;
    const result = parseFrontmatter(input);
    expect(result.metadata).toEqual({ name: "my-skill", description: "A test skill" });
    expect(result.body).toBe("Body content here");
  });

  it("returns empty metadata and full body when no frontmatter", () => {
    const result = parseFrontmatter("No frontmatter at all");
    expect(result.metadata).toEqual({});
    expect(result.body).toBe("No frontmatter at all");
  });

  it("handles empty body after frontmatter", () => {
    const input = `---
name: empty
---`;
    const result = parseFrontmatter(input);
    expect(result.metadata.name).toBe("empty");
    expect(result.body).toBe("");
  });

  it("strips surrounding quotes from values", () => {
    const input = `---
name: "quoted"
description: 'single'
---
content`;
    const result = parseFrontmatter(input);
    expect(result.metadata.name).toBe("quoted");
    expect(result.metadata.description).toBe("single");
  });
});

// ---------------------------------------------------------------------------
// loadSkill
// ---------------------------------------------------------------------------

describe("loadSkill", () => {
  it("loads a SKILL.md file", async () => {
    const skillDir = join(tmpDir, "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: my-skill\n---\nDo the thing`);

    const skill = await loadSkill(skillDir);
    expect(skill).not.toBeNull();
    expect(skill!.meta.name).toBe("my-skill");
    expect(skill!.content).toBe("Do the thing");
  });

  it("returns null when SKILL.md missing", async () => {
    const skillDir = join(tmpDir, "no-skill");
    await mkdir(skillDir, { recursive: true });
    expect(await loadSkill(skillDir)).toBeNull();
  });

  it("falls back to directory name", async () => {
    const skillDir = join(tmpDir, "fallback-name");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Just a readme");
    const skill = await loadSkill(skillDir);
    expect(skill!.meta.name).toBe("fallback-name");
  });
});

// ---------------------------------------------------------------------------
// discoverSkills — bundled, realpath dedup, cache
// ---------------------------------------------------------------------------

describe("discoverSkills", () => {
  it("finds project skills", async () => {
    const projectRoot = tmpDir;
    const userConfigDir = join(tmpDir, "user-config");
    const skillDir = join(projectRoot, ".slc", "skills", "deploy");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: deploy\n---\nDeploy`);

    const skills = await discoverSkills({ projectRoot, userConfigDir });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("deploy");
    expect(skills[0].source).toBe("project");
  });

  it("finds user skills", async () => {
    const userConfigDir = join(tmpDir, "user-config");
    const skillDir = join(userConfigDir, "skills", "review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: review\n---\nReview`);

    const skills = await discoverSkills({ projectRoot: tmpDir, userConfigDir });
    expect(skills).toHaveLength(1);
    expect(skills[0].source).toBe("user");
  });

  it("finds bundled skills when bundledDir provided", async () => {
    const bundledDir = join(tmpDir, "bundled");
    const skillDir = join(bundledDir, "builtin-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: builtin\n---\nBuiltin content`);

    const skills = await discoverSkills({
      projectRoot: tmpDir,
      userConfigDir: join(tmpDir, "user"),
      bundledDir,
    });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("builtin");
    expect(skills[0].source).toBe("bundled");
    // bundled skills should NOT have shell interpolation
    expect(skills[0].allowShellInterpolation).toBe(false);
  });

  it("project > user > bundled priority with dedup", async () => {
    // Create same-named skill in project, user, and bundled
    const projectSkills = join(tmpDir, ".slc", "skills");
    const userSkills = join(tmpDir, "user", "skills");
    const bundledSkills = join(tmpDir, "bundled");
    await mkdir(join(projectSkills, "shared"), { recursive: true });
    await mkdir(join(userSkills, "shared"), { recursive: true });
    await mkdir(join(bundledSkills, "shared"), { recursive: true });
    await writeFile(join(projectSkills, "shared", "SKILL.md"), `---\nname: shared\n---\nproject`);
    await writeFile(join(userSkills, "shared", "SKILL.md"), `---\nname: shared\n---\nuser`);
    await writeFile(join(bundledSkills, "shared", "SKILL.md"), `---\nname: shared\n---\nbundled`);

    const skills = await discoverSkills({
      projectRoot: tmpDir,
      userConfigDir: join(tmpDir, "user"),
      bundledDir: bundledSkills,
    });

    // All three have same name but different realpath — all returned, project first
    expect(skills.length).toBeGreaterThanOrEqual(1);
    expect(skills[0].source).toBe("project");
  });

  it("cache returns same result for same inputs", async () => {
    const projectRoot = tmpDir;
    const userConfigDir = join(tmpDir, "user");
    const skillDir = join(projectRoot, ".slc", "skills", "cached");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: cached\n---\nbody`);

    const first = await discoverSkills({ projectRoot, userConfigDir });
    const second = await discoverSkills({ projectRoot, userConfigDir });
    expect(first).toBe(second); // Same reference = cache hit
  });

  it("different bundledDir invalidates cache", async () => {
    const projectRoot = tmpDir;
    const userConfigDir = join(tmpDir, "user");

    const bundled1 = join(tmpDir, "bundled1");
    const bundled2 = join(tmpDir, "bundled2");
    await mkdir(join(bundled1, "s1"), { recursive: true });
    await writeFile(join(bundled1, "s1", "SKILL.md"), `---\nname: s1\n---\nbody`);
    await mkdir(join(bundled2, "s2"), { recursive: true });
    await writeFile(join(bundled2, "s2", "SKILL.md"), `---\nname: s2\n---\nbody`);

    const first = await discoverSkills({ projectRoot, userConfigDir, bundledDir: bundled1 });
    const second = await discoverSkills({ projectRoot, userConfigDir, bundledDir: bundled2 });

    expect(first).toHaveLength(1);
    expect(first[0].name).toBe("s1");
    expect(second).toHaveLength(1);
    expect(second[0].name).toBe("s2");
  });

  it("force=true refreshes cache", async () => {
    const projectRoot = tmpDir;
    const userConfigDir = join(tmpDir, "user");

    const first = await discoverSkills({ projectRoot, userConfigDir });
    const second = await discoverSkills({ projectRoot, userConfigDir, force: true });
    expect(first).not.toBe(second); // Different reference = cache refreshed
  });

  it("project skills have allowShellInterpolation=true", async () => {
    const skillDir = join(tmpDir, ".slc", "skills", "trusted");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: trusted\n---\nbody`);

    const skills = await discoverSkills({ projectRoot: tmpDir, userConfigDir: join(tmpDir, "user") });
    expect(skills[0].allowShellInterpolation).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// paths activation
// ---------------------------------------------------------------------------

describe("isSkillActiveForPath", () => {
  it("skill with no paths is always active", () => {
    const skill: SkillMeta = { name: "x", description: "", source: "project", path: "/tmp" };
    expect(isSkillActiveForPath(skill, "/any/file.ts", "/project")).toBe(true);
  });

  it("skill with matching path is active", () => {
    const skill: SkillMeta = {
      name: "x", description: "", source: "project", path: "/tmp",
      paths: ["src/**/*.ts"],
    };
    expect(isSkillActiveForPath(skill, "/project/src/main.ts", "/project")).toBe(true);
    expect(isSkillActiveForPath(skill, "/project/src/dir/main.ts", "/project")).toBe(true);
  });

  it("skill with non-matching path is not active", () => {
    const skill: SkillMeta = {
      name: "x", description: "", source: "project", path: "/tmp",
      paths: ["docs/**/*.md"],
    };
    expect(isSkillActiveForPath(skill, "/project/src/main.ts", "/project")).toBe(false);
  });

  it("src/** does NOT match src2/** (prefix boundary)", () => {
    const skill: SkillMeta = {
      name: "x", description: "", source: "project", path: "/tmp",
      paths: ["src/**"],
    };
    expect(isSkillActiveForPath(skill, "/project/src/a.ts", "/project")).toBe(true);
    expect(isSkillActiveForPath(skill, "/project/src2/a.ts", "/project")).toBe(false);
    expect(isSkillActiveForPath(skill, "/project/other/a.ts", "/project")).toBe(false);
  });

  it("src/*.ts does NOT match src/dir/a.ts (single segment)", () => {
    const skill: SkillMeta = {
      name: "x", description: "", source: "project", path: "/tmp",
      paths: ["src/*.ts"],
    };
    expect(isSkillActiveForPath(skill, "/project/src/a.ts", "/project")).toBe(true);
    expect(isSkillActiveForPath(skill, "/project/src/dir/a.ts", "/project")).toBe(false);
  });

  it("skill with literal path match", () => {
    const skill: SkillMeta = {
      name: "x", description: "", source: "project", path: "/tmp",
      paths: ["src/config.ts"],
    };
    expect(isSkillActiveForPath(skill, "/project/src/config.ts", "/project")).toBe(true);
    expect(isSkillActiveForPath(skill, "/project/src/other.ts", "/project")).toBe(false);
  });

  it("filterActiveSkills returns only matching skills", () => {
    const skills: SkillMeta[] = [
      { name: "a", description: "", source: "project", path: "/a", paths: ["src/**"] },
      { name: "b", description: "", source: "project", path: "/b", paths: ["docs/**"] },
      { name: "c", description: "", source: "project", path: "/c" }, // no paths = always active
    ];
    const active = filterActiveSkills(skills, "/project/src/main.ts", "/project");
    expect(active.map((s) => s.name)).toEqual(["a", "c"]);
  });
});

// ---------------------------------------------------------------------------
// executeSkill — shell interpolation + sanitization
// ---------------------------------------------------------------------------

describe("executeSkill", () => {
  it("returns content as-is for untrusted source", async () => {
    const skill = {
      meta: { name: "test", description: "", source: "bundled" as const, path: "/tmp", allowShellInterpolation: false },
      content: "Hello, skill content!",
    };
    const result = await executeSkill(skill, { cwd: "/tmp" });
    expect(result).toBe("Hello, skill content!");
  });

  it("executes shell commands for trusted source", async () => {
    const skill = {
      meta: { name: "test", description: "", source: "project" as const, path: "/tmp", allowShellInterpolation: true },
      content: "Output: `!printf hello`",
    };
    const result = await executeSkill(skill, { cwd: "/tmp" });
    expect(result).toBe("Output: hello");
  });

  it("does not execute shell for allowShellInterpolation=false", async () => {
    const skill = {
      meta: { name: "test", description: "", source: "mcp" as const, path: "/tmp", allowShellInterpolation: false },
      content: "Output: `!printf hello`",
    };
    const result = await executeSkill(skill, { cwd: "/tmp" });
    expect(result).toBe("Output: `!printf hello`");
  });

  it("failed shell command preserves original pattern", async () => {
    const skill = {
      meta: { name: "test", description: "", source: "project" as const, path: "/tmp", allowShellInterpolation: true },
      content: "Output: `!nonexistent_command_xyz`",
    };
    const result = await executeSkill(skill, { cwd: "/tmp" });
    expect(result).toContain("`!nonexistent_command_xyz`");
  });

  it("sanitizes content even for untrusted sources", async () => {
    const skill = {
      meta: { name: "test", description: "", source: "mcp" as const, path: "/tmp", allowShellInterpolation: false },
      content: "Hello​World", // zero-width space
    };
    const result = await executeSkill(skill, { cwd: "/tmp" });
    expect(result).toBe("HelloWorld");
  });
});
