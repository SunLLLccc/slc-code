// Tests for TranscriptWriter

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TranscriptWriter, type TranscriptEvent } from "../../src/session/transcript.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-transcript-"));
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
    metadata: overrides?.metadata,
  };
}

// ---------------------------------------------------------------------------
// TranscriptWriter
// ---------------------------------------------------------------------------

describe("TranscriptWriter", () => {
  it("creates session directory on first append", async () => {
    const sessionDir = join(testDir, "session-1");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });

    await writer.append(makeEvent());

    expect(existsSync(sessionDir)).toBe(true);
    expect(existsSync(join(sessionDir, "transcript.jsonl"))).toBe(true);
  });

  it("writes events as JSON lines", async () => {
    const sessionDir = join(testDir, "session-2");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });

    const event1 = makeEvent({ content: "hello", type: "user" });
    const event2 = makeEvent({ content: "world", type: "assistant" });
    await writer.append(event1);
    await writer.append(event2);

    const content = await readFile(join(sessionDir, "transcript.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsed1 = JSON.parse(lines[0]!);
    expect(parsed1.content).toBe("hello");
    expect(parsed1.type).toBe("user");

    const parsed2 = JSON.parse(lines[1]!);
    expect(parsed2.content).toBe("world");
    expect(parsed2.type).toBe("assistant");
  });

  it("deduplicates events by uuid", async () => {
    const sessionDir = join(testDir, "session-dedup");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });

    const event = makeEvent({ uuid: "dup-uuid", content: "first" });
    await writer.append(event);
    await writer.append({ ...event, content: "second" }); // same uuid

    const content = await readFile(join(sessionDir, "transcript.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).content).toBe("first");
  });

  it("no-ops when enabled=false (bare mode)", async () => {
    const sessionDir = join(testDir, "session-bare");
    const writer = new TranscriptWriter({ sessionDir, enabled: false });

    await writer.append(makeEvent());

    // Directory should not be created
    expect(existsSync(sessionDir)).toBe(false);
  });

  it("isEnabled returns correct status", () => {
    const enabled = new TranscriptWriter({ sessionDir: join(testDir, "a"), enabled: true });
    const disabled = new TranscriptWriter({ sessionDir: join(testDir, "b"), enabled: false });

    expect(enabled.isEnabled()).toBe(true);
    expect(disabled.isEnabled()).toBe(false);
  });

  it("getSessionPath returns session directory", () => {
    const sessionDir = join(testDir, "session-path");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });
    expect(writer.getSessionPath()).toBe(sessionDir);
  });
});
