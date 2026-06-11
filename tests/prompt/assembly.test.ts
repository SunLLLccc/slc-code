import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleSystemPrompt } from "../../src/prompt/assembly.js";

let testDir: string;
let projectDir: string;
let userConfigDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-assembly-test-"));
  projectDir = join(testDir, "project");
  userConfigDir = join(testDir, "user-config");
  await mkdir(projectDir, { recursive: true });
  await mkdir(userConfigDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("assembleSystemPrompt", () => {
  it("includes base prompt from system.md", async () => {
    const prompt = await assembleSystemPrompt({ cwd: projectDir, userConfigDir });
    expect(prompt).toContain("slc code");
  });

  it("places project rules before user rules in assembled prompt", async () => {
    // Create project rule
    await mkdir(join(projectDir, ".slc", "rules"), { recursive: true });
    await writeFile(join(projectDir, ".slc", "rules", "style.md"), "---\n---\nUse tabs for indentation.", "utf-8");

    // Create user rule
    await mkdir(join(userConfigDir, "rules"), { recursive: true });
    await writeFile(join(userConfigDir, "rules", "prefs.md"), "---\n---\nUse spaces for indentation.", "utf-8");

    const prompt = await assembleSystemPrompt({ cwd: projectDir, userConfigDir });
    expect(prompt).toContain("Use tabs for indentation.");
    expect(prompt).toContain("Use spaces for indentation.");

    // Project rule should appear BEFORE user rule (lower position in prompt)
    const projectIdx = prompt!.indexOf("Use tabs");
    const userIdx = prompt!.indexOf("Use spaces");
    expect(projectIdx).toBeLessThan(userIdx);
  });

  it("places user memories after rules in assembled prompt", async () => {
    // Create memory
    await mkdir(join(userConfigDir, "memory"), { recursive: true });
    await writeFile(
      join(userConfigDir, "memory", "lang.md"),
      "---\nname: lang\ndescription: test\nmetadata:\n  type: user\n---\nI prefer Chinese responses.\n",
      "utf-8",
    );

    // Create project rule
    await mkdir(join(projectDir, ".slc", "rules"), { recursive: true });
    await writeFile(join(projectDir, ".slc", "rules", "convention.md"), "---\n---\nUse strict TypeScript.", "utf-8");

    const prompt = await assembleSystemPrompt({ cwd: projectDir, userConfigDir });
    const rulesIdx = prompt!.indexOf("strict TypeScript");
    const memIdx = prompt!.indexOf("Chinese responses");
    expect(rulesIdx).toBeLessThan(memIdx);
  });

  it("returns undefined when skip is true", async () => {
    const prompt = await assembleSystemPrompt({ skip: true });
    expect(prompt).toBeUndefined();
  });

  it("handles missing rules and memory gracefully", async () => {
    const prompt = await assembleSystemPrompt({ cwd: projectDir, userConfigDir });
    expect(prompt).toBeTruthy();
    // Should have base prompt content even without rules/memory
    expect(prompt).toContain("slc code");
  });
});
