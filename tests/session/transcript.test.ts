// Tests for TranscriptWriter

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TranscriptWriter,
  createSidechainWriter,
  isTranscriptEventType,
  type TranscriptEvent,
} from "../../src/session/transcript.js";

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
// isTranscriptEventType
// ---------------------------------------------------------------------------

describe("isTranscriptEventType", () => {
  it("accepts user", () => expect(isTranscriptEventType("user")).toBe(true));
  it("accepts assistant", () => expect(isTranscriptEventType("assistant")).toBe(true));
  it("accepts attachment", () => expect(isTranscriptEventType("attachment")).toBe(true));
  it("accepts system", () => expect(isTranscriptEventType("system")).toBe(true));
  it("rejects tool_result", () => expect(isTranscriptEventType("tool_result")).toBe(false));
  it("rejects tool_call", () => expect(isTranscriptEventType("tool_call")).toBe(false));
  it("rejects empty string", () => expect(isTranscriptEventType("")).toBe(false));
  it("rejects number", () => expect(isTranscriptEventType(42)).toBe(false));
});

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

  it("deduplicates across writer restarts (persistent dedup)", async () => {
    const sessionDir = join(testDir, "session-persist-dedup");

    // First writer
    const writer1 = new TranscriptWriter({ sessionDir, enabled: true });
    await writer1.append(makeEvent({ uuid: "persist-uuid", content: "first" }));
    writer1.close();

    // Second writer — same session dir
    const writer2 = new TranscriptWriter({ sessionDir, enabled: true });
    await writer2.append(makeEvent({ uuid: "persist-uuid", content: "duplicate" }));

    const content = await readFile(join(sessionDir, "transcript.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).content).toBe("first");
  });

  it("rejects non-transcript event types (tool_result)", async () => {
    const sessionDir = join(testDir, "session-validate");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });

    await writer.append(makeEvent({ type: "user", content: "valid" }));
    // @ts-expect-error — testing runtime validation
    await writer.append(makeEvent({ type: "tool_result", content: "rejected" }));

    const content = await readFile(join(sessionDir, "transcript.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).type).toBe("user");
  });

  it("rejects non-transcript event types (tool_call)", async () => {
    const sessionDir = join(testDir, "session-validate-2");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });

    // @ts-expect-error — testing runtime validation
    await writer.append(makeEvent({ type: "tool_call", content: "rejected" }));

    expect(existsSync(join(sessionDir, "transcript.jsonl"))).toBe(false);
  });

  it("sets file permissions to 0600", async () => {
    const sessionDir = join(testDir, "session-perms");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });

    await writer.append(makeEvent());

    const fileStat = await stat(join(sessionDir, "transcript.jsonl"));
    const mode = (fileStat.mode & 0o777).toString(8);
    expect(mode).toBe("600");
  });

  it("sets directory permissions to 0700", async () => {
    const sessionDir = join(testDir, "session-dir-perms");
    const writer = new TranscriptWriter({ sessionDir, enabled: true });

    await writer.append(makeEvent());

    const dirStat = await stat(sessionDir);
    const mode = (dirStat.mode & 0o777).toString(8);
    expect(mode).toBe("700");
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

// ---------------------------------------------------------------------------
// Sidechain Writer — PRD 14.1
// ---------------------------------------------------------------------------

describe("createSidechainWriter", () => {
  it("creates sidechain writer with separate directory", async () => {
    const sessionDir = join(testDir, "session-sidechain");
    const sidechain = createSidechainWriter(sessionDir, "subagent-1", true);

    await sidechain.append(makeEvent({ content: "sidechain event" }));

    // Sidechain should have its own directory
    expect(existsSync(join(sessionDir, "sidechain-subagent-1"))).toBe(true);
    expect(existsSync(join(sessionDir, "sidechain-subagent-1", "transcript.jsonl"))).toBe(true);
  });

  it("sidechain events do not appear in main transcript", async () => {
    const sessionDir = join(testDir, "session-sidechain-isolation");

    // Write to main transcript
    const main = new TranscriptWriter({ sessionDir, enabled: true });
    await main.append(makeEvent({ content: "main event" }));

    // Write to sidechain
    const sidechain = createSidechainWriter(sessionDir, "subagent-1", true);
    await sidechain.append(makeEvent({ content: "sidechain event" }));

    // Main transcript should only have main events
    const mainContent = await readFile(join(sessionDir, "transcript.jsonl"), "utf-8");
    expect(mainContent).toContain("main event");
    expect(mainContent).not.toContain("sidechain event");

    // Sidechain file should have sidechain events
    const sidechainContent = await readFile(
      join(sessionDir, "sidechain-subagent-1", "transcript.jsonl"),
      "utf-8",
    );
    expect(sidechainContent).toContain("sidechain event");
    expect(sidechainContent).not.toContain("main event");
  });
});
