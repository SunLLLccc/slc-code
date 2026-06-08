import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverSkills } from "../../src/skills/discovery.js";
import { loadSkill, parseFrontmatter } from "../../src/skills/loader.js";
import { executeSkill } from "../../src/skills/executor.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "skills-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with body", () => {
    const input = `---
name: my-skill
description: A test skill
---
Body content here`;
    const result = parseFrontmatter(input);
    expect(result.metadata).toEqual({
      name: "my-skill",
      description: "A test skill",
    });
    expect(result.body).toBe("Body content here");
  });

  it("returns empty metadata and full body when no frontmatter", () => {
    const input = "No frontmatter at all";
    const result = parseFrontmatter(input);
    expect(result.metadata).toEqual({});
    expect(result.body).toBe("No frontmatter at all");
  });

  it("returns empty metadata and full body when frontmatter has no closing delimiter", () => {
    const input = `---
name: broken
Body without closing`;
    const result = parseFrontmatter(input);
    expect(result.metadata).toEqual({});
    expect(result.body).toBe(input);
  });

  it("handles empty body after frontmatter", () => {
    const input = `---
name: empty
description: no body
---`;
    const result = parseFrontmatter(input);
    expect(result.metadata).toEqual({ name: "empty", description: "no body" });
    expect(result.body).toBe("");
  });

  it("strips surrounding quotes from values", () => {
    const input = `---
name: "quoted-name"
description: 'single quoted'
---
content`;
    const result = parseFrontmatter(input);
    expect(result.metadata).toEqual({
      name: "quoted-name",
      description: "single quoted",
    });
  });
});

describe("loadSkill", () => {
  it("loads a SKILL.md file and returns a Skill", async () => {
    const skillDir = join(tmpDir, "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: my-skill
description: Does something
---
Do the thing`,
    );

    const skill = await loadSkill(skillDir);
    expect(skill).not.toBeNull();
    expect(skill!.meta.name).toBe("my-skill");
    expect(skill!.meta.description).toBe("Does something");
    expect(skill!.content).toBe("Do the thing");
    expect(skill!.meta.path).toBe(skillDir);
  });

  it("returns null when SKILL.md does not exist", async () => {
    const skillDir = join(tmpDir, "no-skill");
    await mkdir(skillDir, { recursive: true });

    const skill = await loadSkill(skillDir);
    expect(skill).toBeNull();
  });

  it("falls back to directory name when no name in frontmatter", async () => {
    const skillDir = join(tmpDir, "fallback-name");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "# Just a readme\nNo frontmatter",
    );

    const skill = await loadSkill(skillDir);
    expect(skill).not.toBeNull();
    expect(skill!.meta.name).toBe("fallback-name");
  });
});

describe("discoverSkills", () => {
  it("finds project skills from .slc/skills/", async () => {
    const projectRoot = tmpDir;
    const userConfigDir = join(tmpDir, "user-config");
    const skillDir = join(projectRoot, ".slc", "skills", "deploy");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: deploy
description: Deploy stuff
---
Deploy script`,
    );

    const skills = await discoverSkills({ projectRoot, userConfigDir });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("deploy");
    expect(skills[0].source).toBe("project");
  });

  it("finds user skills from user config dir", async () => {
    const projectRoot = tmpDir;
    const userConfigDir = join(tmpDir, "user-config");
    const skillDir = join(userConfigDir, "skills", "review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: review
description: Code review
---
Review prompt`,
    );

    const skills = await discoverSkills({ projectRoot, userConfigDir });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("review");
    expect(skills[0].source).toBe("user");
  });

  it("returns empty array when directories do not exist", async () => {
    const projectRoot = join(tmpDir, "nonexistent");
    const userConfigDir = join(tmpDir, "also-nonexistent");

    const skills = await discoverSkills({ projectRoot, userConfigDir });
    expect(skills).toEqual([]);
  });

  it("returns project skills before user skills", async () => {
    const projectRoot = tmpDir;
    const userConfigDir = join(tmpDir, "user-config");

    const projDir = join(projectRoot, ".slc", "skills", "alpha");
    await mkdir(projDir, { recursive: true });
    await writeFile(
      join(projDir, "SKILL.md"),
      `---
name: alpha
description: project skill
---
body`,
    );

    const userDir = join(userConfigDir, "skills", "beta");
    await mkdir(userDir, { recursive: true });
    await writeFile(
      join(userDir, "SKILL.md"),
      `---
name: beta
description: user skill
---
body`,
    );

    const skills = await discoverSkills({ projectRoot, userConfigDir });
    expect(skills).toHaveLength(2);
    expect(skills[0].source).toBe("project");
    expect(skills[1].source).toBe("user");
  });

  it("skips subdirectories without SKILL.md", async () => {
    const projectRoot = tmpDir;
    const userConfigDir = join(tmpDir, "user-config");
    const skillDir = join(projectRoot, ".slc", "skills", "valid");
    const emptyDir = join(projectRoot, ".slc", "skills", "empty");
    await mkdir(skillDir, { recursive: true });
    await mkdir(emptyDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: valid
description: has skill file
---
body`,
    );

    const skills = await discoverSkills({ projectRoot, userConfigDir });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("valid");
  });
});

describe("executeSkill", () => {
  it("returns the skill content as-is", async () => {
    const skill = {
      meta: {
        name: "test",
        description: "A test skill",
        source: "project" as const,
        path: "/tmp/test",
      },
      content: "Hello, skill content!",
    };

    const result = await executeSkill(skill, { cwd: "/tmp" });
    expect(result).toBe("Hello, skill content!");
  });
});
