// Tests for /resume, /session, /rename, /rewind commands

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDefaultRegistry } from "../../src/commands/index.js";
import { TranscriptWriter } from "../../src/session/transcript.js";
import { SessionManager } from "../../src/repl/session-manager.js";
import { createResumeSession } from "../../src/repl/session-runtime.js";
import { QueryEngine } from "../../src/engine/engine.js";
import type { Provider } from "../../src/engine/providers/base.js";
import type { CommandContext } from "../../src/commands/registry.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-session-cmds-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function makeContext(overrides?: Partial<CommandContext> & Record<string, unknown>): CommandContext {
  const { config: configOverride, ...rest } = overrides ?? {};
  return {
    config: {
      sessionsBase: testDir,
      ...configOverride,
    },
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// /session command
// ---------------------------------------------------------------------------

describe("/session command", () => {
  it("returns no sessions when none exist", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/session", makeContext());
    expect(result).toContain("No sessions");
  });

  it("lists available sessions", async () => {
    const sessionDir = join(testDir, "test-session");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });
    await writer.append({
      uuid: "evt-1",
      type: "user",
      timestamp: new Date().toISOString(),
      content: "Hello",
    });

    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/session", makeContext());
    expect(result).toContain("Available sessions");
    expect(result).toContain("Hello");
    expect(result).toContain("1 event");
  });
});

// ---------------------------------------------------------------------------
// /resume command
// ---------------------------------------------------------------------------

describe("/resume command", () => {
  it("returns error when no sessions to resume", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/resume", makeContext());
    expect(result).toContain("No sessions");
  });

  it("resumes the most recent session", async () => {
    const sessionDir = join(testDir, "resume-test");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });
    await writer.append({
      uuid: "evt-1",
      type: "user",
      timestamp: new Date().toISOString(),
      content: "Hello",
    });
    await writer.append({
      uuid: "evt-2",
      type: "assistant",
      timestamp: new Date().toISOString(),
      content: "Hi there!",
    });

    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/resume", makeContext());
    expect(result).toContain("Resumed session");
    expect(result).toContain("Events: 2");
  });

  it("resumes a specific session by ID", async () => {
    const sessionDir = join(testDir, "specific-session");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });
    await writer.append({
      uuid: "evt-1",
      type: "user",
      timestamp: new Date().toISOString(),
      content: "Test",
    });

    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/resume specific-session", makeContext());
    expect(result).toContain("Resumed session");
    expect(result).toContain("Events: 1");
  });

  it("calls resumeSession callback and verifies QueryEngine state", async () => {
    const sessionDir = join(testDir, "resume-callback");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });
    await writer.append({
      uuid: "evt-1",
      type: "user",
      timestamp: new Date().toISOString(),
      content: "Hello from resume",
    });
    await writer.append({
      uuid: "evt-2",
      type: "assistant",
      timestamp: new Date().toISOString(),
      content: "Hi from resume",
    });

    const resumeSession = vi.fn().mockResolvedValue(true);
    const registry = createDefaultRegistry();
    const result = await registry.dispatch(
      "/resume resume-callback",
      makeContext({ resumeSession }),
    );
    expect(result).toContain("Resumed session");
    expect(resumeSession).toHaveBeenCalledWith(join(testDir, "resume-callback"));
  });

  it("returns error for nonexistent session ID", async () => {
    const sessionDir = join(testDir, "existing-session");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });
    await writer.append({
      uuid: "evt-1",
      type: "user",
      timestamp: new Date().toISOString(),
      content: "Test",
    });

    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/resume nonexistent", makeContext());
    expect(result).toContain("empty");
  });
});

// ---------------------------------------------------------------------------
// /rename command
// ---------------------------------------------------------------------------

describe("/rename command", () => {
  it("returns usage when no args given", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/rename", makeContext());
    expect(result).toContain("Usage");
  });

  it("renames the current session", async () => {
    const sessionDir = join(testDir, "rename-test");
    await mkdir(sessionDir, { recursive: true });

    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/rename My New Title", makeContext({ config: { sessionsBase: testDir, sessionDir } }));
    expect(result).toContain("renamed");
    expect(result).toContain("My New Title");
  });
});

// ---------------------------------------------------------------------------
// /rewind command
// ---------------------------------------------------------------------------

describe("/rewind command", () => {
  it("returns usage when no args given", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/rewind", makeContext());
    expect(result).toContain("Usage");
  });

  it("reports events for a valid UUID", async () => {
    const sessionDir = join(testDir, "rewind-test");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });
    await writer.append({
      uuid: "evt-1",
      type: "user",
      timestamp: new Date().toISOString(),
      content: "First",
    });
    await writer.append({
      uuid: "evt-2",
      type: "assistant",
      timestamp: new Date().toISOString(),
      content: "Second",
    });
    await writer.append({
      uuid: "evt-3",
      type: "user",
      timestamp: new Date().toISOString(),
      content: "Third",
    });

    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/rewind evt-2", makeContext({ config: { sessionsBase: testDir, sessionDir } }));
    expect(result).toContain("evt-2");
    expect(result).toContain("Kept: 2");
    expect(result).toContain("Removed: 1");
  });

  it("calls rewindToEvent callback with correct UUID", async () => {
    const sessionDir = join(testDir, "rewind-callback");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });
    await writer.append({
      uuid: "evt-1",
      type: "user",
      timestamp: new Date().toISOString(),
      content: "First",
    });
    await writer.append({
      uuid: "evt-2",
      type: "assistant",
      timestamp: new Date().toISOString(),
      content: "Second",
    });

    const rewindToEvent = vi.fn().mockResolvedValue(true);
    const registry = createDefaultRegistry();
    const result = await registry.dispatch(
      "/rewind evt-1",
      makeContext({ rewindToEvent, config: { sessionsBase: testDir, sessionDir } }),
    );
    expect(result).toContain("Rewound");
    expect(rewindToEvent).toHaveBeenCalledWith("evt-1");
  });

  it("returns error for nonexistent UUID", async () => {
    const sessionDir = join(testDir, "rewind-empty");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });
    await writer.append({
      uuid: "evt-1",
      type: "user",
      timestamp: new Date().toISOString(),
      content: "Test",
    });

    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/rewind nonexistent-uuid", makeContext({ config: { sessionsBase: testDir, sessionDir } }));
    expect(result).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// createDefaultRegistry includes all session commands
// ---------------------------------------------------------------------------

describe("createDefaultRegistry includes session commands", () => {
  it("has /resume", () => {
    expect(createDefaultRegistry().has("resume")).toBe(true);
  });

  it("has /session", () => {
    expect(createDefaultRegistry().has("session")).toBe(true);
  });

  it("has /rename", () => {
    expect(createDefaultRegistry().has("rename")).toBe(true);
  });

  it("has /rewind", () => {
    expect(createDefaultRegistry().has("rewind")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createResumeSession + SessionManager integration
// ---------------------------------------------------------------------------

describe("createResumeSession + SessionManager integration", () => {
  // Minimal mock provider — never actually called
  const mockProvider: Provider = {
    name: "mock",
    async *stream() {},
    supportsToolUse: false,
    supportsStreaming: false,
  };

  it("resume updates SessionManager sessionDir and subsequent append goes to target", async () => {
    // Create two sessions
    const oldDir = join(testDir, "old-session");
    const targetDir = join(testDir, "target-session");
    const oldWriter = new TranscriptWriter({ sessionDir: oldDir, enabled: true });
    await oldWriter.append({ uuid: "old-1", type: "user", timestamp: "", content: "old" });
    const targetWriter = new TranscriptWriter({ sessionDir: targetDir, enabled: true });
    await targetWriter.append({ uuid: "t-1", type: "user", timestamp: "", content: "target" });

    // SessionManager starts in old session
    const sm = new SessionManager({ sessionsBase: testDir, enabled: true });
    await sm.cleanupAndInit(30);
    // Manually switch to old
    await sm.switchSession(oldDir);
    expect(sm.sessionDir).toBe(oldDir);

    // Create resume callback and call it
    const engine = new QueryEngine(mockProvider);
    const resume = createResumeSession(engine, sm, testDir);
    const result = await resume(targetDir);
    expect(result).toBe(true);

    // SessionManager now points to target
    expect(sm.sessionDir).toBe(targetDir);

    // Subsequent append goes to target, not old
    await sm.appendUserEvent("After resume");
    expect(existsSync(join(targetDir, "transcript.jsonl"))).toBe(true);
    const content = await readFile(join(targetDir, "transcript.jsonl"), "utf-8");
    expect(content).toContain("After resume");
    // Old session unchanged
    const oldContent = await readFile(join(oldDir, "transcript.jsonl"), "utf-8");
    expect(oldContent).not.toContain("After resume");
  });

  it("resume in bare mode updates sessionDir but no writer", async () => {
    const targetDir = join(testDir, "target-bare");
    const targetWriter = new TranscriptWriter({ sessionDir: targetDir, enabled: true });
    await targetWriter.append({ uuid: "t-1", type: "user", timestamp: "", content: "target" });

    const sm = new SessionManager({ sessionsBase: testDir, enabled: false });
    await sm.cleanupAndInit(30);

    const engine = new QueryEngine(mockProvider);
    const resume = createResumeSession(engine, sm, testDir);
    const result = await resume(targetDir);
    expect(result).toBe(true);

    // sessionDir updated
    expect(sm.sessionDir).toBe(targetDir);
    // But no writer — append no-op
    await sm.appendUserEvent("Bare no-op");
    const content = await readFile(join(targetDir, "transcript.jsonl"), "utf-8");
    expect(content).not.toContain("Bare no-op");
  });
});
