// Tests for SessionManager — real lifecycle scenarios

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "../../src/repl/session-manager.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-session-mgr-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// cleanupAndInit — real lifecycle
// ---------------------------------------------------------------------------

describe("SessionManager.cleanupAndInit", () => {
  it("creates session dir and writer when enabled + cleanupPeriodDays > 0", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    await sm.cleanupAndInit(30);

    expect(sm.sessionDir).toBeTruthy();
    expect(sm.sessionId).toBeTruthy();

    // Writer is active — append creates transcript
    await sm.appendUserEvent("Hello");
    expect(existsSync(join(sm.sessionDir!, "transcript.jsonl"))).toBe(true);
  });

  it("cleanupPeriodDays=0 deletes old sessions and does NOT create writer", async () => {
    // Create an old session
    const oldDir = join(testDir, "old-session");
    await mkdir(oldDir, { recursive: true });
    await writeFile(join(oldDir, "transcript.jsonl"), "{}");

    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    await sm.cleanupAndInit(0);

    // Old session deleted
    expect(existsSync(oldDir)).toBe(false);
    // No current session created
    expect(sm.sessionDir).toBeNull();
    expect(sm.sessionId).toBeNull();

    // Append is no-op
    await sm.appendUserEvent("Should not write");
    // No transcript created anywhere
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(testDir));
    expect(entries).toHaveLength(0);
  });

  it("bare mode (enabled=false) does not create writer regardless of cleanupPeriodDays", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: false });
    await sm.cleanupAndInit(30);

    expect(sm.sessionDir).toBeNull();
    await sm.appendUserEvent("No-op");
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(testDir));
    expect(entries).toHaveLength(0);
  });

  it("cleanupPeriodDays > 0 keeps recent sessions, deletes old ones", async () => {
    // Create a recent session (just created)
    const recentDir = join(testDir, "recent-session");
    await mkdir(recentDir, { recursive: true });
    await writeFile(join(recentDir, "transcript.jsonl"), "{}");

    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    await sm.cleanupAndInit(30);

    // Recent session kept
    expect(existsSync(recentDir)).toBe(true);
    // New session created
    expect(sm.sessionDir).toBeTruthy();
    expect(sm.sessionDir).not.toBe(recentDir);
  });

  it("cleanup happens before session init — no race", async () => {
    // Create old session
    const oldDir = join(testDir, "old");
    await mkdir(oldDir, { recursive: true });
    await writeFile(join(oldDir, "transcript.jsonl"), "{}");

    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    await sm.cleanupAndInit(0); // cleanupPeriodDays=0 = delete all

    // Old session is gone BEFORE we could append
    expect(existsSync(oldDir)).toBe(false);
    // No writer created
    expect(sm.sessionDir).toBeNull();
  });

  it("idempotent — calling cleanupAndInit twice is safe", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    await sm.cleanupAndInit(30);
    const firstDir = sm.sessionDir;

    await sm.cleanupAndInit(30);
    // Second call is no-op — same session dir
    expect(sm.sessionDir).toBe(firstDir);
  });
});

// ---------------------------------------------------------------------------
// switchSession
// ---------------------------------------------------------------------------

describe("SessionManager.switchSession", () => {
  it("switches to existing session and writes to it", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    await sm.cleanupAndInit(30);

    const newDir = join(testDir, "resumed-session");
    sm.switchSession(newDir);
    expect(sm.sessionDir).toBe(newDir);

    await sm.appendUserEvent("After switch");
    expect(existsSync(join(newDir, "transcript.jsonl"))).toBe(true);
  });

  it("bare mode switchSession updates sessionDir but no writer", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: false });
    await sm.cleanupAndInit(30);

    const newDir = join(testDir, "resumed-session");
    sm.switchSession(newDir);
    expect(sm.sessionDir).toBe(newDir);

    await sm.appendUserEvent("No-op");
    expect(existsSync(join(newDir, "transcript.jsonl"))).toBe(false);
  });

  it("cleanupPeriodDays=0 switchSession updates sessionDir but no writer", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    await sm.cleanupAndInit(0);

    const newDir = join(testDir, "resumed-session");
    sm.switchSession(newDir);
    expect(sm.sessionDir).toBe(newDir);

    await sm.appendUserEvent("No-op");
    expect(existsSync(join(newDir, "transcript.jsonl"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isEnabled / isInitialized
// ---------------------------------------------------------------------------

describe("SessionManager state", () => {
  it("isEnabled reflects constructor option", () => {
    const enabled = new SessionManager({ sessionsBase: testDir, enabled: true });
    const disabled = new SessionManager({ sessionsBase: testDir, enabled: false });

    expect(enabled.isEnabled).toBe(true);
    expect(disabled.isEnabled).toBe(false);
  });

  it("isInitialized after cleanupAndInit", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    expect(sm.isInitialized).toBe(false);

    await sm.cleanupAndInit(30);
    expect(sm.isInitialized).toBe(true);
  });
});
