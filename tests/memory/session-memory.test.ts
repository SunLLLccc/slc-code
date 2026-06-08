// Tests for session memory

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadSessionMemory,
  writeSessionMemory,
  hasSessionMemory,
} from "../../src/memory/session-memory.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-sess-mem-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("loadSessionMemory", () => {
  it("returns empty string when no memory exists", async () => {
    const content = await loadSessionMemory(testDir);
    expect(content).toBe("");
  });

  it("loads existing session memory", async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "session-memory.md"), "# Session\nWorking on P9");

    const content = await loadSessionMemory(testDir);
    expect(content).toContain("Working on P9");
  });
});

describe("writeSessionMemory", () => {
  it("writes session memory to sessionDir", async () => {
    const result = await writeSessionMemory(testDir, "# Session\nKey findings");
    expect(result).toBe(true);
    expect(existsSync(join(testDir, "session-memory.md"))).toBe(true);

    const content = await readFile(join(testDir, "session-memory.md"), "utf-8");
    expect(content).toContain("Key findings");
  });

  it("no-ops when persistenceEnabled is false", async () => {
    const result = await writeSessionMemory(testDir, "# Session", false);
    expect(result).toBe(false);
    expect(existsSync(join(testDir, "session-memory.md"))).toBe(false);
  });

  it("sets file permissions to 0600", async () => {
    await writeSessionMemory(testDir, "# Session");
    const { stat } = await import("node:fs/promises");
    const fileStat = await stat(join(testDir, "session-memory.md"));
    const mode = (fileStat.mode & 0o777).toString(8);
    expect(mode).toBe("600");
  });
});

describe("hasSessionMemory", () => {
  it("returns false when no memory exists", () => {
    expect(hasSessionMemory(testDir)).toBe(false);
  });

  it("returns true when memory exists", async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "session-memory.md"), "# Session");
    expect(hasSessionMemory(testDir)).toBe(true);
  });
});
