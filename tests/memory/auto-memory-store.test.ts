// Tests for auto memory store

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeAutoMemories } from "../../src/memory/auto-memory-store.js";
import type { MemoryEntry } from "../../src/memory/recall.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-auto-mem-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function makeEntry(overrides?: Partial<MemoryEntry>): MemoryEntry {
  return {
    name: overrides?.name ?? "test-memory",
    description: overrides?.description ?? "A test memory",
    content: overrides?.content ?? "User prefers TypeScript",
    metadata: overrides?.metadata ?? { type: "user" },
  };
}

describe("writeAutoMemories", () => {
  it("writes memories to memory directory", async () => {
    const entries = [makeEntry({ name: "pref-ts" })];
    const written = await writeAutoMemories(testDir, entries);

    expect(written).toBe(1);
    expect(existsSync(join(testDir, "pref-ts.md"))).toBe(true);

    const content = await readFile(join(testDir, "pref-ts.md"), "utf-8");
    expect(content).toContain("name: pref-ts");
    expect(content).toContain("type: user");
    expect(content).toContain("User prefers TypeScript");
  });

  it("writes multiple memories", async () => {
    const entries = [
      makeEntry({ name: "memory-1" }),
      makeEntry({ name: "memory-2" }),
      makeEntry({ name: "memory-3" }),
    ];
    const written = await writeAutoMemories(testDir, entries);

    expect(written).toBe(3);
    const files = await readdir(testDir);
    expect(files.filter((f) => f.endsWith(".md"))).toHaveLength(3);
  });

  it("no-ops when enabled=false", async () => {
    const entries = [makeEntry()];
    const written = await writeAutoMemories(testDir, entries, { enabled: false });

    expect(written).toBe(0);
    const files = await readdir(testDir);
    expect(files).toHaveLength(0);
  });

  it("returns 0 for empty entries", async () => {
    const written = await writeAutoMemories(testDir, []);
    expect(written).toBe(0);
  });

  it("sets file permissions to 0600", async () => {
    const entries = [makeEntry()];
    await writeAutoMemories(testDir, entries);

    const { stat } = await import("node:fs/promises");
    const fileStat = await stat(join(testDir, "test-memory.md"));
    const mode = (fileStat.mode & 0o777).toString(8);
    expect(mode).toBe("600");
  });

  it("creates memory directory if it doesn't exist", async () => {
    const nestedDir = join(testDir, "nested", "memory");
    const entries = [makeEntry()];
    await writeAutoMemories(nestedDir, entries);

    expect(existsSync(join(nestedDir, "test-memory.md"))).toBe(true);
  });
});
