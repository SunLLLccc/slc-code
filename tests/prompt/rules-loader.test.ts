// Tests for rules loader — SLC.md and .slc/rules/*.md

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRules } from "../../src/prompt/rules-loader.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-rules-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("loadRules", () => {
  it("returns empty array when no rules exist", async () => {
    const rules = await loadRules({ projectRoot: testDir });
    expect(rules).toEqual([]);
  });

  it("loads project SLC.md", async () => {
    await writeFile(join(testDir, "SLC.md"), "# Project Rules\nUse TypeScript");

    const rules = await loadRules({ projectRoot: testDir });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain("Use TypeScript");
  });

  it("loads project .slc/rules/*.md sorted alphabetically", async () => {
    const rulesDir = join(testDir, ".slc", "rules");
    await mkdir(rulesDir, { recursive: true });
    await writeFile(join(rulesDir, "b-style.md"), "# Style\nUse prettier");
    await writeFile(join(rulesDir, "a-lint.md"), "# Lint\nUse eslint");

    const rules = await loadRules({ projectRoot: testDir });
    expect(rules).toHaveLength(2);
    // a-lint.md comes before b-style.md alphabetically
    expect(rules[0]).toContain("eslint");
    expect(rules[1]).toContain("prettier");
  });

  it("loads user rules with lower priority than project rules", async () => {
    const userDir = join(testDir, "user-config");
    await mkdir(userDir, { recursive: true });
    await writeFile(join(userDir, "SLC.md"), "# User Rules\nBe concise");

    await writeFile(join(testDir, "SLC.md"), "# Project Rules\nUse TypeScript");

    const rules = await loadRules({ projectRoot: testDir, userConfigDir: userDir });
    // Project SLC.md has higher priority (comes first)
    expect(rules).toHaveLength(2);
    expect(rules[0]).toContain("Use TypeScript");
    expect(rules[1]).toContain("Be concise");
  });

  it("handles missing directories gracefully", async () => {
    const rules = await loadRules({
      projectRoot: join(testDir, "nonexistent"),
      userConfigDir: join(testDir, "also-nonexistent"),
    });
    expect(rules).toEqual([]);
  });
});
