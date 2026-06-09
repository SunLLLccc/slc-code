// Session / Memory / Compact e2e tests
//
// Tests:
// 1. TranscriptWriter write/read/dedup cycle
// 2. Disabled writer does not create files (--bare)
// 3. SessionManager with enabled=false creates no session dir
// 4. --bare mode: no transcript.jsonl, no session-memory.md, no auto memory .md
// 5. Non-bare control group DOES write files
// 6. Session event flow (user/assistant)
// 7. compactMessages
// 8. Session memory write/read cycle

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TranscriptWriter } from "../../src/session/transcript.js";
import { SessionManager } from "../../src/repl/session-manager.js";
import { loadTranscript, rebuildSessionState } from "../../src/session/resume.js";
import { compactMessages } from "../../src/context/compact.js";
import { loadMemories, formatMemoriesForPrompt } from "../../src/memory/recall.js";
import type { TranscriptEvent } from "../../src/session/transcript.js";
import type { ProviderMessage } from "../../src/engine/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-e2e-session-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function makeEvent(
  type: "user" | "assistant",
  content: string,
  uuid?: string,
): TranscriptEvent {
  return {
    uuid: uuid ?? crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    content,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TranscriptWriter", () => {
  it("writes and reads back events", async () => {
    const sessionDir = join(testDir, "session-1");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });

    const event1 = makeEvent("user", "hello");
    const event2 = makeEvent("assistant", "hi there");

    await writer.append(event1);
    await writer.append(event2);
    writer.close();

    const result = await loadTranscript(sessionDir);
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events[0].content).toBe("hello");
    expect(result.events[1].content).toBe("hi there");
  });

  it("deduplicates by uuid", async () => {
    const sessionDir = join(testDir, "session-dedup");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });

    const event = makeEvent("user", "once", "fixed-uuid");
    await writer.append(event);
    await writer.append(event); // duplicate
    writer.close();

    const result = await loadTranscript(sessionDir);
    expect(result.events).toHaveLength(1);
  });

  it("disabled writer does not write", async () => {
    const sessionDir = join(testDir, "session-disabled");
    const writer = new TranscriptWriter({ sessionDir, enabled: false });

    await writer.append(makeEvent("user", "ignored"));
    writer.close();

    const result = await loadTranscript(sessionDir);
    expect(result.events).toHaveLength(0);
  });
});

describe("Session — event flow", () => {
  it("writes user/assistant events and reads back via loadTranscript", async () => {
    const sessionDir = join(testDir, "session-flow");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });

    const events = [
      makeEvent("user", "What is TypeScript?"),
      makeEvent("assistant", "TypeScript is a typed superset of JavaScript."),
      makeEvent("user", "How do I install it?"),
      makeEvent("assistant", "npm install -g typescript"),
    ];

    for (const e of events) {
      await writer.append(e);
    }
    writer.close();

    const result = await loadTranscript(sessionDir);
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(4);

    // rebuildSessionState converts to ProviderMessage format
    const messages = rebuildSessionState(result.events);
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });
});

describe("compactMessages", () => {
  it("preserves last 10 non-system messages", () => {
    const messages: ProviderMessage[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: i % 2 === 0 ? "user" : "assistant", content: `msg ${i}` });
    }

    const compacted = compactMessages(messages);
    // Should have: summary system message + last 10
    expect(compacted).toHaveLength(11);
    expect(compacted[0].role).toBe("system");
    expect(compacted[0].content).toContain("10 earlier messages");
    // Last message should be msg 19
    expect(compacted[compacted.length - 1].content).toBe("msg 19");
  });

  it("returns messages unchanged when count <= 10", () => {
    const messages: ProviderMessage[] = [];
    for (let i = 0; i < 8; i++) {
      messages.push({ role: "user", content: `msg ${i}` });
    }

    const compacted = compactMessages(messages);
    expect(compacted).toHaveLength(8);
    expect(compacted[0].content).toBe("msg 0");
  });

  it("preserves system messages", () => {
    const messages: ProviderMessage[] = [
      { role: "system", content: "You are helpful." },
    ];
    for (let i = 0; i < 15; i++) {
      messages.push({ role: "user", content: `msg ${i}` });
    }

    const compacted = compactMessages(messages);
    // system + summary + last 10
    expect(compacted).toHaveLength(12);
    expect(compacted[0].role).toBe("system");
    expect(compacted[0].content).toBe("You are helpful.");
    expect(compacted[1].role).toBe("system");
    expect(compacted[1].content).toContain("earlier messages");
  });
});

describe("Session memory — write/read cycle", () => {
  it("loadMemories reads .md files with frontmatter", async () => {
    const memoryDir = join(testDir, "memory");
    await mkdir(memoryDir, { recursive: true });

    await writeFile(
      join(memoryDir, "test-memory.md"),
      `---
name: test memory
description: A test memory entry
metadata:
  type: user
---
This is the memory content.`,
      "utf-8",
    );

    const memories = await loadMemories(memoryDir);
    expect(memories).toHaveLength(1);
    expect(memories[0].name).toBe("test memory");
    expect(memories[0].description).toBe("A test memory entry");
    expect(memories[0].content).toBe("This is the memory content.");
    expect(memories[0].metadata.type).toBe("user");
  });

  it("formatMemoriesForPrompt formats entries", async () => {
    const memoryDir = join(testDir, "memory-fmt");
    await mkdir(memoryDir, { recursive: true });

    await writeFile(
      join(memoryDir, "pref.md"),
      `---
name: preferences
metadata:
  type: user
---
Always use TypeScript.`,
      "utf-8",
    );

    const memories = await loadMemories(memoryDir);
    const formatted = formatMemoriesForPrompt(memories);
    expect(formatted).toContain("preferences");
    expect(formatted).toContain("Always use TypeScript.");
  });

  it("returns empty for missing directory", async () => {
    const memories = await loadMemories(join(testDir, "nonexistent"));
    expect(memories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// --bare mode verification — real filesystem paths
// ---------------------------------------------------------------------------

describe("--bare mode — no persistence files created", () => {
  it("SessionManager with enabled=false creates no session directory", async () => {
    const sessionsBase = join(testDir, "bare-sessions");
    const sm = new SessionManager({ sessionsBase, enabled: false });

    await sm.cleanupAndInit(30);

    // Should be initialized but with no session dir
    expect(sm.isInitialized).toBe(true);
    expect(sm.sessionDir).toBeNull();
    expect(sm.isEnabled).toBe(false);

    // Try to append events — should be no-ops
    await sm.appendUserEvent("test user message");
    await sm.appendAssistantEvent("test assistant message");

    // No session directory should exist at all
    let dirExists = true;
    try {
      await stat(sessionsBase);
    } catch {
      dirExists = false;
    }
    // If the base dir was created, it should be empty (no session subdirs)
    if (dirExists) {
      const entries = await readdir(sessionsBase);
      expect(entries).toEqual([]);
    }

    sm.close();
  });

  it("TranscriptWriter with enabled=false writes no transcript.jsonl", async () => {
    const sessionDir = join(testDir, "bare-session-dir");
    await mkdir(sessionDir, { recursive: true });

    const writer = new TranscriptWriter({ sessionDir, enabled: false });

    await writer.append({
      uuid: "bare-test-uuid",
      type: "user",
      timestamp: new Date().toISOString(),
      content: "this should not be written",
    });
    writer.close();

    // transcript.jsonl should NOT exist
    let fileExists = true;
    try {
      await stat(join(sessionDir, "transcript.jsonl"));
    } catch {
      fileExists = false;
    }
    expect(fileExists).toBe(false);
  });

  it("non-bare control group DOES write transcript.jsonl", async () => {
    const sessionDir = join(testDir, "non-bare-session");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });

    await writer.append({
      uuid: "control-uuid",
      type: "user",
      timestamp: new Date().toISOString(),
      content: "this should be written",
    });
    writer.close();

    // transcript.jsonl SHOULD exist
    const result = await loadTranscript(sessionDir);
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].content).toBe("this should be written");
  });

  it("bare mode SessionManager does not create session-memory.md or auto memory files", async () => {
    const sessionsBase = join(testDir, "bare-mem-test");
    const sm = new SessionManager({ sessionsBase, enabled: false });
    await sm.cleanupAndInit(30);

    // Append events (should be no-ops)
    await sm.appendUserEvent("remember this");
    await sm.appendAssistantEvent("noted");

    // Verify no session dir was created
    expect(sm.sessionDir).toBeNull();

    // Even if we look at the entire sessions base, no memory files should exist
    let dirExists = true;
    try {
      await stat(sessionsBase);
    } catch {
      dirExists = false;
    }

    if (dirExists) {
      // Walk the directory tree — should be empty
      const entries = await readdir(sessionsBase);
      expect(entries).toEqual([]);
    }

    sm.close();
  });

  it("non-bare SessionManager creates session dir and writes events", async () => {
    const sessionsBase = join(testDir, "nonbare-sessions");
    const sm = new SessionManager({ sessionsBase, enabled: true });

    await sm.cleanupAndInit(30);

    // Should have created a session directory
    expect(sm.isInitialized).toBe(true);
    expect(sm.sessionDir).not.toBeNull();
    expect(sm.isEnabled).toBe(true);

    // Append events
    await sm.appendUserEvent("hello from user");
    await sm.appendAssistantEvent("hello from assistant");

    // Read back the transcript
    const sessionDir = sm.sessionDir!;
    const result = await loadTranscript(sessionDir);
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events[0].content).toBe("hello from user");
    expect(result.events[1].content).toBe("hello from assistant");

    sm.close();
  });
});
