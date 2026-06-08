// Tests for auto memory lifecycle — real path behavior

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { processAutoMemory } from "../../src/memory/auto-memory-lifecycle.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-auto-mem-lifecycle-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("processAutoMemory", () => {
  const conversation = {
    user: "I prefer using TypeScript for all projects",
    assistant: "Got it, I'll use TypeScript going forward.",
  };

  it("writes memories when all conditions met", async () => {
    const memoryDir = join(testDir, "memory");
    const written = await processAutoMemory(conversation.user, conversation.assistant, {
      persistenceEnabled: true,
      autoMemoryEnabled: true,
      cleanupPeriodDays: 30,
      cwd: testDir,
      memoryDir,
    });

    expect(written).toBeGreaterThan(0);
    expect(existsSync(memoryDir)).toBe(true);
    const files = await readdir(memoryDir);
    expect(files.some((f) => f.endsWith(".md"))).toBe(true);
  });

  it("does NOT write when autoMemoryEnabled=false", async () => {
    const memoryDir = join(testDir, "memory");
    const written = await processAutoMemory(conversation.user, conversation.assistant, {
      persistenceEnabled: true,
      autoMemoryEnabled: false,
      cleanupPeriodDays: 30,
      cwd: testDir,
      memoryDir,
    });

    expect(written).toBe(0);
    expect(existsSync(memoryDir)).toBe(false);
  });

  it("does NOT write when persistenceEnabled=false (bare mode)", async () => {
    const memoryDir = join(testDir, "memory");
    const written = await processAutoMemory(conversation.user, conversation.assistant, {
      persistenceEnabled: false,
      autoMemoryEnabled: true,
      cleanupPeriodDays: 30,
      cwd: testDir,
      memoryDir,
    });

    expect(written).toBe(0);
    expect(existsSync(memoryDir)).toBe(false);
  });

  it("does NOT write when cleanupPeriodDays=0", async () => {
    const memoryDir = join(testDir, "memory");
    const written = await processAutoMemory(conversation.user, conversation.assistant, {
      persistenceEnabled: true,
      autoMemoryEnabled: true,
      cleanupPeriodDays: 0,
      cwd: testDir,
      memoryDir,
    });

    expect(written).toBe(0);
    expect(existsSync(memoryDir)).toBe(false);
  });

  it("defaults memoryDir to {cwd}/.slc/memory when not specified", async () => {
    const written = await processAutoMemory(conversation.user, conversation.assistant, {
      persistenceEnabled: true,
      autoMemoryEnabled: true,
      cleanupPeriodDays: 30,
      cwd: testDir,
      // no memoryDir specified
    });

    expect(written).toBeGreaterThan(0);
    const defaultDir = join(testDir, ".slc", "memory");
    expect(existsSync(defaultDir)).toBe(true);
    const files = await readdir(defaultDir);
    expect(files.some((f) => f.endsWith(".md"))).toBe(true);
  });

  it("uses explicit memoryDir over project .slc/memory", async () => {
    const explicitDir = join(testDir, "custom-memory");
    const written = await processAutoMemory(conversation.user, conversation.assistant, {
      persistenceEnabled: true,
      autoMemoryEnabled: true,
      cleanupPeriodDays: 30,
      cwd: testDir,
      memoryDir: explicitDir,
    });

    expect(written).toBeGreaterThan(0);
    expect(existsSync(explicitDir)).toBe(true);
    // Project .slc/memory should NOT be created
    expect(existsSync(join(testDir, ".slc", "memory"))).toBe(false);
  });

  it("returns 0 for conversation without extractable patterns", async () => {
    const memoryDir = join(testDir, "memory");
    const written = await processAutoMemory("hello", "hi there", {
      persistenceEnabled: true,
      autoMemoryEnabled: true,
      cleanupPeriodDays: 30,
      cwd: testDir,
      memoryDir,
    });

    expect(written).toBe(0);
  });
});
