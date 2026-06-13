// Tests for SessionManager — real lifecycle scenarios + race condition coverage

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
// ensureInitialized — race condition coverage
// ---------------------------------------------------------------------------

describe("SessionManager.ensureInitialized", () => {
  it("append before cleanupAndInit completes still writes transcript", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    // Start cleanupAndInit but don't await — simulates React useEffect fire-and-forget
    const initPromise = sm.cleanupAndInit(30);

    // Immediately call append — should wait for init to complete
    await sm.appendUserEvent("Race condition test");

    await initPromise;

    // User event was written (not lost)
    expect(sm.sessionDir).toBeTruthy();
    const content = await readFile(join(sm.sessionDir!, "transcript.jsonl"), "utf-8");
    expect(content).toContain("Race condition test");
  });

  it("append before cleanupAndInit with cleanupPeriodDays=0 is no-op", async () => {
    // Create old session
    const oldDir = join(testDir, "old");
    await mkdir(oldDir, { recursive: true });
    await writeFile(join(oldDir, "transcript.jsonl"), "{}");

    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    // Start cleanupAndInit with cleanupPeriodDays=0
    const initPromise = sm.cleanupAndInit(0);

    // Immediately call append — should wait, then no-op
    await sm.appendUserEvent("Should not be written");

    await initPromise;

    // No writer created, no transcript
    expect(sm.sessionDir).toBeNull();
    expect(existsSync(oldDir)).toBe(false);
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(testDir));
    expect(entries).toHaveLength(0);
  });

  it("append before cleanupAndInit in bare mode is no-op", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: false });
    const initPromise = sm.cleanupAndInit(30);

    await sm.appendUserEvent("Bare mode no-op");

    await initPromise;

    expect(sm.sessionDir).toBeNull();
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(testDir));
    expect(entries).toHaveLength(0);
  });

  it("multiple appends before init all wait and succeed", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    const initPromise = sm.cleanupAndInit(30);

    // Fire multiple appends concurrently — all should wait
    await Promise.all([
      sm.appendUserEvent("First"),
      sm.appendUserEvent("Second"),
      sm.appendAssistantEvent("Reply"),
    ]);

    await initPromise;

    const content = await readFile(join(sm.sessionDir!, "transcript.jsonl"), "utf-8");
    expect(content).toContain("First");
    expect(content).toContain("Second");
    expect(content).toContain("Reply");
  });
});

// ---------------------------------------------------------------------------
// switchSession (now async)
// ---------------------------------------------------------------------------

describe("SessionManager.switchSession", () => {
  it("switches to existing session and writes to it", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    await sm.cleanupAndInit(30);

    const newDir = join(testDir, "resumed-session");
    await sm.switchSession(newDir);
    expect(sm.sessionDir).toBe(newDir);

    await sm.appendUserEvent("After switch");
    expect(existsSync(join(newDir, "transcript.jsonl"))).toBe(true);
  });

  it("bare mode switchSession updates sessionDir but no writer", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: false });
    await sm.cleanupAndInit(30);

    const newDir = join(testDir, "resumed-session");
    await sm.switchSession(newDir);
    expect(sm.sessionDir).toBe(newDir);

    await sm.appendUserEvent("No-op");
    expect(existsSync(join(newDir, "transcript.jsonl"))).toBe(false);
  });

  it("cleanupPeriodDays=0 switchSession updates sessionDir but no writer", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    await sm.cleanupAndInit(0);

    const newDir = join(testDir, "resumed-session");
    await sm.switchSession(newDir);
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

  it("writable is true after cleanupAndInit with cleanupPeriodDays>0", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    await sm.cleanupAndInit(30);
    expect(sm.writable).toBe(true);
  });

  it("writable is false after cleanupAndInit with cleanupPeriodDays=0", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    await sm.cleanupAndInit(0);
    expect(sm.writable).toBe(false);
  });

  it("writable is false in bare mode", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: false });
    await sm.cleanupAndInit(30);
    expect(sm.writable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Resume + cleanupPeriodDays=0 semantic
// ---------------------------------------------------------------------------

describe("SessionManager resume semantics", () => {
  it("cleanupPeriodDays=0: switchSession does NOT create writer after resume", async () => {
    // Create a session to "resume"
    const resumeDir = join(testDir, "target-session");
    await mkdir(resumeDir, { recursive: true });
    await writeFile(join(resumeDir, "transcript.jsonl"), JSON.stringify({ type: "user", content: "old msg" }) + "\n");

    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    // cleanupPeriodDays=0: deletes all sessions (including target), no writer
    await sm.cleanupAndInit(0);

    expect(sm.writable).toBe(false);
    // Target session was cleaned up
    expect(existsSync(resumeDir)).toBe(false);

    // switchSession updates dir but no writer (writable=false)
    await sm.switchSession(resumeDir);
    expect(sm.sessionDir).toBe(resumeDir);

    // Append is no-op — no transcript written
    await sm.appendUserEvent("Should not persist");
    expect(existsSync(join(resumeDir, "transcript.jsonl"))).toBe(false);
  });

  it("cleanupPeriodDays>0: switchSession creates writer and writes to resumed session", async () => {
    // Create a session to resume
    const resumeDir = join(testDir, "target-session");
    await mkdir(resumeDir, { recursive: true });
    await writeFile(join(resumeDir, "transcript.jsonl"), JSON.stringify({ type: "user", content: "old msg" }) + "\n");

    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    // cleanupPeriodDays>0: skip cleanup with -1 to preserve target session
    await sm.cleanupAndInit(-1);

    expect(sm.writable).toBe(true);

    // switchSession redirects writer to resumed session
    await sm.switchSession(resumeDir);
    await sm.appendUserEvent("New message after resume");

    // Transcript now contains both old and new content
    const content = await readFile(join(resumeDir, "transcript.jsonl"), "utf-8");
    expect(content).toContain("old msg");
    expect(content).toContain("New message after resume");
  });
});
