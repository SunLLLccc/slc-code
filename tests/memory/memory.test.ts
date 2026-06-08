import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadMemories,
  formatMemoriesForPrompt,
  MEMORY_MAX_LINES,
  type MemoryEntry,
} from "../../src/memory/recall.js";
import { extractMemories } from "../../src/memory/auto-memory.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "slc-memory-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("loadMemories", () => {
  it("loads memories from valid frontmatter files", async () => {
    const content = `---
name: coding-style
description: Preferred coding conventions
metadata:
  type: project
---
Always use TypeScript strict mode.
Use ES modules over CommonJS.
`;
    await writeFile(join(tempDir, "coding-style.md"), content, "utf-8");

    const entries = await loadMemories(tempDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("coding-style");
    expect(entries[0].description).toBe("Preferred coding conventions");
    expect(entries[0].metadata.type).toBe("project");
    expect(entries[0].content).toContain("TypeScript strict mode");
  });

  it("returns empty array for empty directory", async () => {
    const emptyDir = join(tempDir, "empty");
    await mkdir(emptyDir);
    const entries = await loadMemories(emptyDir);
    expect(entries).toEqual([]);
  });

  it("returns empty array for non-existent directory", async () => {
    const entries = await loadMemories("/tmp/nonexistent_dir_xyz_123");
    expect(entries).toEqual([]);
  });

  it("skips files without valid frontmatter", async () => {
    await writeFile(join(tempDir, "invalid.md"), "no frontmatter here", "utf-8");

    const entries = await loadMemories(tempDir);
    expect(entries).toHaveLength(0);
  });

  it("skips non-.md files", async () => {
    await writeFile(join(tempDir, "note.txt"), "some text", "utf-8");

    const entries = await loadMemories(tempDir);
    expect(entries).toHaveLength(0);
  });

  it("defaults type to reference for unknown metadata type", async () => {
    const content = `---
name: misc
metadata:
  type: unknown_type
---
Some content.
`;
    await writeFile(join(tempDir, "misc.md"), content, "utf-8");

    const entries = await loadMemories(tempDir);
    expect(entries[0].metadata.type).toBe("reference");
  });

  it("sorts entries alphabetically by filename", async () => {
    const template = (name: string) => `---
name: ${name}
metadata:
  type: user
---
Content of ${name}.
`;
    await writeFile(join(tempDir, "b.md"), template("second"), "utf-8");
    await writeFile(join(tempDir, "a.md"), template("first"), "utf-8");

    const entries = await loadMemories(tempDir);
    expect(entries[0].name).toBe("first");
    expect(entries[1].name).toBe("second");
  });
});

describe("formatMemoriesForPrompt", () => {
  it("returns empty string for empty array", () => {
    expect(formatMemoriesForPrompt([])).toBe("");
  });

  it("formats a single memory entry", () => {
    const entries: MemoryEntry[] = [
      {
        name: "prefs",
        description: "User preferences",
        content: "Use vim keybindings",
        metadata: { type: "user" },
      },
    ];
    const result = formatMemoriesForPrompt(entries);
    expect(result).toContain("### prefs");
    expect(result).toContain("_User preferences_");
    expect(result).toContain("Use vim keybindings");
  });

  it("respects MEMORY_MAX_LINES limit", () => {
    // Fill up close to the limit with many small entries
    const entries: MemoryEntry[] = Array.from({ length: MEMORY_MAX_LINES }, (_, i) => ({
      name: `entry-${i}`,
      description: "",
      content: `Content of entry ${i}`,
      metadata: { type: "user" as const },
    }));
    // Add one more that should be skipped
    entries.push({
      name: "should-be-skipped",
      description: "",
      content: "This should not appear",
      metadata: { type: "user" },
    });
    const result = formatMemoriesForPrompt(entries);
    expect(result).toContain("entry-0");
    expect(result).not.toContain("should-be-skipped");
  });
});

describe("extractMemories", () => {
  it("returns empty array for text with no patterns", () => {
    const result = extractMemories("Hello, how are you today?");
    expect(result).toEqual([]);
  });

  it('finds "I prefer..." pattern', () => {
    const result = extractMemories("I prefer using tabs over spaces for indentation");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].metadata.type).toBe("user");
    expect(result[0].content).toContain("tabs over spaces");
  });

  it('finds "always use..." pattern', () => {
    const result = extractMemories("always use strict TypeScript in all projects");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].metadata.type).toBe("user");
  });

  it('finds "the project uses..." pattern', () => {
    const result = extractMemories("the project uses vitest for testing");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].metadata.type).toBe("project");
  });

  it("deduplicates similar patterns", () => {
    const text = "I prefer dark mode. I prefer dark mode.";
    const result = extractMemories(text);
    expect(result).toHaveLength(1);
  });
});
