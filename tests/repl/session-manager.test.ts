// Tests for SessionManager

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
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
// SessionManager
// ---------------------------------------------------------------------------

describe("SessionManager", () => {
  it("sets sessionDir on initSession and creates dir on first append", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    sm.initSession();

    expect(sm.sessionDir).toBeTruthy();
    expect(sm.sessionId).toBeTruthy();
    // Directory is created lazily on first append
    await sm.appendUserEvent("trigger dir creation");
    expect(existsSync(sm.sessionDir!)).toBe(true);
  });

  it("writes user event to transcript", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    sm.initSession();

    await sm.appendUserEvent("Hello world");

    const content = await readFile(join(sm.sessionDir!, "transcript.jsonl"), "utf-8");
    const events = content.trim().split("\n").map((l) => JSON.parse(l));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("user");
    expect(events[0].content).toBe("Hello world");
  });

  it("writes assistant event to transcript", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    sm.initSession();

    await sm.appendAssistantEvent("Hi there!");

    const content = await readFile(join(sm.sessionDir!, "transcript.jsonl"), "utf-8");
    const events = content.trim().split("\n").map((l) => JSON.parse(l));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("assistant");
    expect(events[0].content).toBe("Hi there!");
  });

  it("writes user then assistant events in order", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    sm.initSession();

    await sm.appendUserEvent("Question");
    await sm.appendAssistantEvent("Answer");

    const content = await readFile(join(sm.sessionDir!, "transcript.jsonl"), "utf-8");
    const events = content.trim().split("\n").map((l) => JSON.parse(l));
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("user");
    expect(events[1].type).toBe("assistant");
  });

  it("no-ops when enabled=false (bare mode)", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: false });
    sm.initSession();

    expect(sm.sessionDir).toBeNull();
    expect(sm.sessionId).toBeNull();

    await sm.appendUserEvent("Should not write");
    // No directory should be created
    expect(existsSync(join(testDir, "any-session"))).toBe(false);
  });

  it("switchSession updates sessionDir and writer", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    sm.initSession();

    const originalDir = sm.sessionDir;
    expect(originalDir).toBeTruthy();

    // Switch to a different session
    const newDir = join(testDir, "resumed-session");
    sm.switchSession(newDir);

    expect(sm.sessionDir).toBe(newDir);

    // New writes go to the new session
    await sm.appendUserEvent("After switch");
    expect(existsSync(join(newDir, "transcript.jsonl"))).toBe(true);
  });

  it("switchSession in bare mode updates sessionDir but no writer", async () => {
    const sm = new SessionManager({ sessionsBase: testDir, enabled: false });

    // switchSession should update runtime state even in bare mode
    const newDir = join(testDir, "resumed-session");
    sm.switchSession(newDir);
    expect(sm.sessionDir).toBe(newDir);

    // But no writer is created — append should no-op
    await sm.appendUserEvent("Should not write");
    expect(existsSync(join(newDir, "transcript.jsonl"))).toBe(false);
  });

  it("isEnabled reflects constructor option", () => {
    const enabled = new SessionManager({ sessionsBase: testDir, enabled: true });
    const disabled = new SessionManager({ sessionsBase: testDir, enabled: false });

    expect(enabled.isEnabled).toBe(true);
    expect(disabled.isEnabled).toBe(false);
  });
});
