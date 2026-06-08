// Tests for session cleanup

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupSessions } from "../../src/session/cleanup.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-cleanup-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// cleanupSessions
// ---------------------------------------------------------------------------

describe("cleanupSessions", () => {
  it("deletes all sessions when cleanupPeriodDays=0", async () => {
    // Create two sessions
    await mkdir(join(testDir, "session-1"), { recursive: true });
    await writeFile(join(testDir, "session-1", "transcript.jsonl"), "{}");
    await mkdir(join(testDir, "session-2"), { recursive: true });
    await writeFile(join(testDir, "session-2", "transcript.jsonl"), "{}");

    const result = await cleanupSessions({
      sessionsBase: testDir,
      cleanupPeriodDays: 0,
    });

    expect(result.deleted).toBe(2);
    expect(result.kept).toBe(0);
    expect(existsSync(join(testDir, "session-1"))).toBe(false);
    expect(existsSync(join(testDir, "session-2"))).toBe(false);
  });

  it("keeps recent sessions when cleanupPeriodDays > 0", async () => {
    // Create a session (just created, so it's recent)
    await mkdir(join(testDir, "recent-session"), { recursive: true });
    await writeFile(join(testDir, "recent-session", "transcript.jsonl"), "{}");

    const result = await cleanupSessions({
      sessionsBase: testDir,
      cleanupPeriodDays: 30,
    });

    expect(result.deleted).toBe(0);
    expect(result.kept).toBe(1);
    expect(existsSync(join(testDir, "recent-session"))).toBe(true);
  });

  it("does nothing when cleanupPeriodDays < 0", async () => {
    await mkdir(join(testDir, "session-1"), { recursive: true });
    await writeFile(join(testDir, "session-1", "transcript.jsonl"), "{}");

    const result = await cleanupSessions({
      sessionsBase: testDir,
      cleanupPeriodDays: -1,
    });

    expect(result.deleted).toBe(0);
    expect(result.kept).toBe(0);
    expect(existsSync(join(testDir, "session-1"))).toBe(true);
  });

  it("handles nonexistent sessions directory gracefully", async () => {
    const result = await cleanupSessions({
      sessionsBase: join(testDir, "nonexistent"),
      cleanupPeriodDays: 0,
    });

    expect(result.deleted).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});
