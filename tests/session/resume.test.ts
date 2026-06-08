// Tests for resume loading

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadTranscript,
  getAvailableSessions,
  getSessionMetadata,
  getSessionMetadataLite,
  rebuildSessionState,
} from "../../src/session/resume.js";
import { TranscriptWriter, type TranscriptEvent } from "../../src/session/transcript.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-resume-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function makeEvent(overrides?: Partial<TranscriptEvent>): TranscriptEvent {
  return {
    uuid: overrides?.uuid ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: overrides?.type ?? "user",
    timestamp: overrides?.timestamp ?? new Date().toISOString(),
    content: overrides?.content ?? "test message",
  };
}

// ---------------------------------------------------------------------------
// loadTranscript
// ---------------------------------------------------------------------------

describe("loadTranscript", () => {
  it("loads events from a valid transcript file", async () => {
    const sessionDir = join(testDir, "session-1");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });
    await writer.append(makeEvent({ content: "hello" }));
    await writer.append(makeEvent({ content: "world", type: "assistant" }));

    const result = await loadTranscript(sessionDir);
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]!.content).toBe("hello");
    expect(result.events[1]!.content).toBe("world");
  });

  it("returns empty for missing transcript file", async () => {
    const sessionDir = join(testDir, "nonexistent");
    const result = await loadTranscript(sessionDir);
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(0);
  });

  it("skips malformed JSON lines", async () => {
    const sessionDir = join(testDir, "session-malformed");
    await mkdir(sessionDir, { recursive: true });
    const validEvent = JSON.stringify(makeEvent({ content: "valid" }));
    await writeFile(
      join(sessionDir, "transcript.jsonl"),
      `${validEvent}\nnot valid json\n${validEvent}\n`,
      "utf-8",
    );

    const result = await loadTranscript(sessionDir);
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(2);
  });

  it("skips non-transcript event types", async () => {
    const sessionDir = join(testDir, "session-filter");
    await mkdir(sessionDir, { recursive: true });
    const userEvent = JSON.stringify(makeEvent({ content: "user msg", type: "user" }));
    const toolEvent = JSON.stringify({ uuid: "tool-1", type: "tool_result", timestamp: new Date().toISOString(), content: "tool output" });
    await writeFile(
      join(sessionDir, "transcript.jsonl"),
      `${userEvent}\n${toolEvent}\n`,
      "utf-8",
    );

    const result = await loadTranscript(sessionDir);
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe("user");
  });

  it("returns empty for empty file", async () => {
    const sessionDir = join(testDir, "session-empty");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "transcript.jsonl"), "", "utf-8");

    const result = await loadTranscript(sessionDir);
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getSessionMetadataLite — PRD 14.4
// ---------------------------------------------------------------------------

describe("getSessionMetadataLite", () => {
  it("returns null for nonexistent session", async () => {
    const meta = await getSessionMetadataLite(join(testDir, "nonexistent"));
    expect(meta).toBeNull();
  });

  it("returns metadata for small files (full read)", async () => {
    const sessionDir = join(testDir, "session-lite-small");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });
    await writer.append(makeEvent({ content: "First user message", type: "user" }));
    await writer.append(makeEvent({ content: "Assistant reply", type: "assistant" }));

    const meta = await getSessionMetadataLite(sessionDir);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe("First user message");
    expect(meta!.eventCount).toBe(2);
  });

  it("handles large files without full read", async () => {
    const sessionDir = join(testDir, "session-lite-large");
    await mkdir(sessionDir, { recursive: true });

    // Create a large transcript file (> 128KB)
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(JSON.stringify(makeEvent({ content: `Event ${i} ${"x".repeat(100)}`, type: i === 0 ? "user" : "assistant" })));
    }
    await writeFile(join(sessionDir, "transcript.jsonl"), lines.join("\n") + "\n", "utf-8");

    const meta = await getSessionMetadataLite(sessionDir);
    expect(meta).not.toBeNull();
    expect(meta!.title).toContain("Event 0");
    expect(meta!.eventCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getAvailableSessions
// ---------------------------------------------------------------------------

describe("getAvailableSessions", () => {
  it("returns empty array for empty base directory", async () => {
    const sessions = await getAvailableSessions(testDir);
    expect(sessions).toEqual([]);
  });

  it("lists session directories sorted by mtime", async () => {
    const dir1 = join(testDir, "session-old");
    const dir2 = join(testDir, "session-new");
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
    await writeFile(join(dir1, "transcript.jsonl"), JSON.stringify(makeEvent()), "utf-8");
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(join(dir2, "transcript.jsonl"), JSON.stringify(makeEvent()), "utf-8");

    const sessions = await getAvailableSessions(testDir);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toBe("session-new");
    expect(sessions[1]).toBe("session-old");
  });
});

// ---------------------------------------------------------------------------
// getSessionMetadata
// ---------------------------------------------------------------------------

describe("getSessionMetadata", () => {
  it("returns metadata for a valid session", async () => {
    const sessionDir = join(testDir, "session-meta");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });
    await writer.append(makeEvent({ content: "First user message", type: "user" }));
    await writer.append(makeEvent({ content: "Assistant reply", type: "assistant" }));

    const meta = await getSessionMetadata(sessionDir);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe("First user message");
    expect(meta!.eventCount).toBe(2);
    expect(meta!.lastModified).toBeTruthy();
  });

  it("truncates long title to 120 chars", async () => {
    const sessionDir = join(testDir, "session-long");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });
    const longContent = "x".repeat(200);
    await writer.append(makeEvent({ content: longContent, type: "user" }));

    const meta = await getSessionMetadata(sessionDir);
    expect(meta!.title.length).toBeLessThanOrEqual(123);
    expect(meta!.title).toContain("...");
  });

  it("returns null for nonexistent session", async () => {
    const meta = await getSessionMetadata(join(testDir, "nonexistent"));
    expect(meta).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rebuildSessionState
// ---------------------------------------------------------------------------

describe("rebuildSessionState", () => {
  it("converts user/assistant/system events to ProviderMessages", () => {
    const events: TranscriptEvent[] = [
      { uuid: "1", type: "system", timestamp: "", content: "You are helpful" },
      { uuid: "2", type: "user", timestamp: "", content: "Hello" },
      { uuid: "3", type: "assistant", timestamp: "", content: "Hi there!" },
    ];

    const messages = rebuildSessionState(events);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: "system", content: "You are helpful" });
    expect(messages[1]).toEqual({ role: "user", content: "Hello" });
    expect(messages[2]).toEqual({ role: "assistant", content: "Hi there!" });
  });

  it("converts attachment events to user messages", () => {
    const events: TranscriptEvent[] = [
      { uuid: "1", type: "attachment", timestamp: "", content: "file.ts content" },
    ];

    const messages = rebuildSessionState(events);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content).toContain("Attachment");
  });

  it("skips non-transcript types", () => {
    const events = [
      { uuid: "1", type: "user", timestamp: "", content: "Hello" },
      { uuid: "2", type: "tool_result", timestamp: "", content: "output" },
    ] as TranscriptEvent[];

    const messages = rebuildSessionState(events);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
  });
});
