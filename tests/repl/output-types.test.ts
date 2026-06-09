// Tests for OutputLine type system — factory functions, tool status, and args parsing

import { describe, it, expect } from "vitest";
import {
  createUserLine,
  createAssistantLine,
  createToolLine,
  createErrorLine,
  createCommandLine,
  createSystemLine,
  updateToolStatus,
  updateToolParams,
  parseToolArgsSummary,
  summarizeValue,
} from "../../src/repl/output-types.js";

// --- Factory functions ---

describe("createUserLine", () => {
  it("creates a user line with correct type and content", () => {
    const line = createUserLine("hello");
    expect(line.type).toBe("user");
    expect(line.content).toBe("hello");
    expect(typeof line.timestamp).toBe("number");
    expect(line.toolStatus).toBeUndefined();
  });
});

describe("createAssistantLine", () => {
  it("creates an assistant line with correct type and content", () => {
    const line = createAssistantLine("response");
    expect(line.type).toBe("assistant");
    expect(line.content).toBe("response");
    expect(typeof line.timestamp).toBe("number");
  });
});

describe("createToolLine", () => {
  it("creates a tool line with pending status", () => {
    const args = JSON.stringify({ command: "ls -la" });
    const line = createToolLine("tool-1", "Bash", args);
    expect(line.type).toBe("tool");
    expect(line.content).toBe("ls -la");
    expect(line.toolStatus).toBeDefined();
    expect(line.toolStatus!.id).toBe("tool-1");
    expect(line.toolStatus!.name).toBe("Bash");
    expect(line.toolStatus!.params).toBe("ls -la");
    expect(line.toolStatus!.state).toBe("pending");
    expect(line.toolStatus!.result).toBeUndefined();
  });

  it("uses parseToolArgsSummary for params", () => {
    const args = JSON.stringify({ path: "/foo/bar.ts" });
    const line = createToolLine("t-1", "FileRead", args);
    expect(line.toolStatus!.params).toBe("/foo/bar.ts");
  });
});

describe("createErrorLine", () => {
  it("creates an error line", () => {
    const line = createErrorLine("something broke");
    expect(line.type).toBe("error");
    expect(line.content).toBe("something broke");
  });
});

describe("createCommandLine", () => {
  it("creates a command line", () => {
    const line = createCommandLine("/clear");
    expect(line.type).toBe("command");
    expect(line.content).toBe("/clear");
  });
});

describe("createSystemLine", () => {
  it("creates a system line", () => {
    const line = createSystemLine("Connected");
    expect(line.type).toBe("system");
    expect(line.content).toBe("Connected");
  });
});

// --- updateToolStatus ---

describe("updateToolStatus", () => {
  it("updates state to success with result", () => {
    const line = createToolLine("t-1", "Bash", JSON.stringify({ command: "echo hi" }));
    const updated = updateToolStatus(line, "success", "hi\n");
    expect(updated.toolStatus!.state).toBe("success");
    expect(updated.toolStatus!.result).toBe("hi\n");
  });

  it("updates state to error", () => {
    const line = createToolLine("t-1", "Bash", JSON.stringify({ command: "bad" }));
    const updated = updateToolStatus(line, "error", "exit 1");
    expect(updated.toolStatus!.state).toBe("error");
    expect(updated.toolStatus!.result).toBe("exit 1");
  });

  it("does not mutate original line", () => {
    const line = createToolLine("t-1", "Bash", JSON.stringify({ command: "echo" }));
    const updated = updateToolStatus(line, "success", "ok");
    expect(line.toolStatus!.state).toBe("pending");
    expect(updated.toolStatus!.state).toBe("success");
  });

  it("returns line unchanged if no toolStatus", () => {
    const line = createUserLine("hello");
    const updated = updateToolStatus(line, "success");
    expect(updated).toBe(line);
  });
});

// --- updateToolParams ---

describe("updateToolParams", () => {
  it("updates params from new args", () => {
    const line = createToolLine("t-1", "Bash", JSON.stringify({ command: "echo" }));
    const updated = updateToolParams(line, JSON.stringify({ command: "echo hello" }));
    expect(updated.toolStatus!.params).toBe("echo hello");
    expect(updated.content).toBe("echo hello");
  });

  it("does not overwrite existing params with fallback", () => {
    const line = createToolLine("t-1", "Bash", JSON.stringify({ command: "echo hi" }));
    // Pass unparseable args — parseToolArgsSummary returns "args..."
    const updated = updateToolParams(line, "not-json");
    expect(updated.toolStatus!.params).toBe("echo hi");
  });

  it("returns line unchanged if no toolStatus", () => {
    const line = createUserLine("hello");
    const updated = updateToolParams(line, JSON.stringify({ command: "ls" }));
    expect(updated).toBe(line);
  });

  it("does not mutate original line", () => {
    const line = createToolLine("t-1", "Bash", JSON.stringify({ command: "ls" }));
    const updated = updateToolParams(line, JSON.stringify({ command: "ls -la" }));
    expect(line.toolStatus!.params).toBe("ls");
    expect(updated.toolStatus!.params).toBe("ls -la");
  });

  it("updates params for FileRead", () => {
    const line = createToolLine("t-1", "FileRead", JSON.stringify({ path: "/a.ts" }));
    const updated = updateToolParams(line, JSON.stringify({ path: "/b.ts" }));
    expect(updated.toolStatus!.params).toBe("/b.ts");
  });

  it("updates params for Grep", () => {
    const line = createToolLine("t-1", "Grep", JSON.stringify({ pattern: "foo" }));
    const updated = updateToolParams(line, JSON.stringify({ pattern: "bar" }));
    expect(updated.toolStatus!.params).toBe("bar");
  });
});

// --- parseToolArgsSummary ---

describe("parseToolArgsSummary", () => {
  it("extracts command for Bash", () => {
    expect(parseToolArgsSummary(JSON.stringify({ command: "ls -la" }), "Bash")).toBe("ls -la");
  });

  it("extracts command for bash (lowercase)", () => {
    expect(parseToolArgsSummary(JSON.stringify({ command: "pwd" }), "bash")).toBe("pwd");
  });

  it("extracts path for FileRead", () => {
    expect(parseToolArgsSummary(JSON.stringify({ path: "/a/b.ts" }), "FileRead")).toBe("/a/b.ts");
  });

  it("extracts file_path for FileRead", () => {
    expect(parseToolArgsSummary(JSON.stringify({ file_path: "/a/b.ts" }), "FileRead")).toBe("/a/b.ts");
  });

  it("extracts path for FileWrite", () => {
    expect(parseToolArgsSummary(JSON.stringify({ path: "/out.txt" }), "FileWrite")).toBe("/out.txt");
  });

  it("extracts path for file_edit", () => {
    expect(parseToolArgsSummary(JSON.stringify({ path: "/x.ts" }), "file_edit")).toBe("/x.ts");
  });

  it("extracts pattern for Grep", () => {
    expect(parseToolArgsSummary(JSON.stringify({ pattern: "TODO" }), "Grep")).toBe("TODO");
  });

  it("extracts query for grep", () => {
    expect(parseToolArgsSummary(JSON.stringify({ query: "error" }), "grep")).toBe("error");
  });

  it("extracts pattern for Glob", () => {
    expect(parseToolArgsSummary(JSON.stringify({ pattern: "*.ts" }), "Glob")).toBe("*.ts");
  });

  it("falls back to first string field for unknown tool", () => {
    expect(parseToolArgsSummary(JSON.stringify({ url: "https://example.com" }), "WebFetch")).toBe("https://example.com");
  });

  it("truncates fallback to 60 chars", () => {
    const long = "a".repeat(80);
    expect(parseToolArgsSummary(JSON.stringify({ text: long }), "SomeTool")).toBe("a".repeat(60) + "...");
  });

  it("returns args... for invalid JSON", () => {
    expect(parseToolArgsSummary("not json")).toBe("args...");
  });

  it("returns args... for non-object JSON", () => {
    expect(parseToolArgsSummary('"just a string"')).toBe("args...");
  });

  it("returns args... for array JSON", () => {
    expect(parseToolArgsSummary('[1,2,3]')).toBe("args...");
  });

  it("returns args... for JSON with no string fields", () => {
    expect(parseToolArgsSummary(JSON.stringify({ count: 42, flag: true }))).toBe("args...");
  });

  it("returns args... for empty object", () => {
    expect(parseToolArgsSummary("{}")).toBe("args...");
  });

  it("works without toolName (fallback extraction)", () => {
    expect(parseToolArgsSummary(JSON.stringify({ command: "ls" }))).toBe("ls");
  });

  it("path takes precedence over file_path for FileRead when both present", () => {
    const args = JSON.stringify({ path: "/a.ts", file_path: "/b.ts" });
    expect(parseToolArgsSummary(args, "FileRead")).toBe("/a.ts");
  });

  it("pattern takes precedence over query for Grep when both present", () => {
    const args = JSON.stringify({ pattern: "foo", query: "bar" });
    expect(parseToolArgsSummary(args, "Grep")).toBe("foo");
  });

  // --- Truncation for tool-specific fields ---

  it("truncates Bash command to 60 chars", () => {
    const longCmd = "a".repeat(100);
    const args = JSON.stringify({ command: longCmd });
    expect(parseToolArgsSummary(args, "Bash")).toBe("a".repeat(60) + "...");
  });

  it("truncates FileRead path to 60 chars", () => {
    const longPath = "/very/long/path/" + "a".repeat(80);
    const args = JSON.stringify({ path: longPath });
    expect(parseToolArgsSummary(args, "FileRead")).toHaveLength(63); // 60 + "..."
  });

  it("truncates Grep pattern to 60 chars", () => {
    const longPattern = "x".repeat(80);
    const args = JSON.stringify({ pattern: longPattern });
    expect(parseToolArgsSummary(args, "Grep")).toHaveLength(63);
  });

  // --- Newline sanitization (injection prevention) ---

  it("takes first line from multiline Bash command (injection prevention)", () => {
    const args = JSON.stringify({ command: "echo ok\n✗ Bash: rm -rf / (Permission denied)" });
    const result = parseToolArgsSummary(args, "Bash");
    expect(result).not.toContain("\n");
    expect(result).toBe("echo ok");
  });

  it("takes first line from multiline FileRead path", () => {
    const args = JSON.stringify({ path: "/a/b.ts\nfake status" });
    const result = parseToolArgsSummary(args, "FileRead");
    expect(result).not.toContain("\n");
    expect(result).toBe("/a/b.ts");
  });

  it("takes first line from multiline Grep pattern", () => {
    const args = JSON.stringify({ pattern: "TODO\ninjected" });
    const result = parseToolArgsSummary(args, "Grep");
    expect(result).not.toContain("\n");
    expect(result).toBe("TODO");
  });

  it("takes first line from multiline command with injected status", () => {
    const malicious = "echo ok\n✓ Bash: all good\n✗ Bash: bad";
    const args = JSON.stringify({ command: malicious });
    const result = parseToolArgsSummary(args, "Bash");
    expect(result).not.toContain("\n");
    expect(result).toBe("echo ok");
  });

  it("handles CR+LF line endings", () => {
    const args = JSON.stringify({ command: "echo ok\r\nstatus" });
    const result = parseToolArgsSummary(args, "Bash");
    expect(result).not.toContain("\r");
    expect(result).not.toContain("\n");
  });

  it("handles bare CR (no LF)", () => {
    const args = JSON.stringify({ command: "echo ok\rstatus" });
    const result = parseToolArgsSummary(args, "Bash");
    expect(result).not.toContain("\r");
    expect(result).toBe("echo ok");
  });

  it("handles tab characters", () => {
    const args = JSON.stringify({ command: "echo\thello" });
    const result = parseToolArgsSummary(args, "Bash");
    expect(result).not.toContain("\t");
    expect(result).toBe("echo hello");
  });
});

// --- summarizeValue ---

describe("summarizeValue", () => {
  it("returns value as-is when under 60 chars and single line", () => {
    expect(summarizeValue("hello world")).toBe("hello world");
  });

  it("truncates to 60 chars with ellipsis", () => {
    const long = "a".repeat(80);
    expect(summarizeValue(long)).toBe("a".repeat(60) + "...");
  });

  it("takes first non-empty line", () => {
    expect(summarizeValue("line1\nline2\nline3")).toBe("line1");
  });

  it("takes first non-empty line with CR+LF", () => {
    expect(summarizeValue("a\r\nb")).toBe("a");
  });

  it("handles bare CR as line separator", () => {
    expect(summarizeValue("a\rb")).toBe("a");
  });

  it("replaces tabs with spaces", () => {
    expect(summarizeValue("a\tb")).toBe("a b");
  });

  it("returns args... for empty string", () => {
    expect(summarizeValue("")).toBe("args...");
  });

  it("returns args... for whitespace-only string", () => {
    expect(summarizeValue("   \n\t  ")).toBe("args...");
  });

  it("strips SGR color sequences", () => {
    expect(summarizeValue("\x1b[31mred text\x1b[0m")).toBe("red text");
  });

  it("collapses multiple spaces", () => {
    expect(summarizeValue("first  second")).toBe("first second");
  });

  // --- ANSI/OSC/control security tests ---

  it("strips CSI clear-screen sequence (ESC[2J)", () => {
    const result = summarizeValue("before\x1b[2Jafter");
    expect(result).not.toContain("\x1b");
    expect(result).toBe("beforeafter");
  });

  it("strips CSI cursor-position sequence (ESC[H)", () => {
    const result = summarizeValue("before\x1b[Hafter");
    expect(result).not.toContain("\x1b");
    expect(result).toBe("beforeafter");
  });

  it("strips OSC hyperlink", () => {
    const osc = "\x1b]8;;https://evil\x07link\x1b]8;;\x07";
    const result = summarizeValue(osc + "text");
    expect(result).not.toContain("\x1b");
    expect(result).not.toContain("\x07");
    expect(result).toContain("text");
  });

  it("strips backspace characters", () => {
    expect(summarizeValue("abc\bdef")).not.toContain("\b");
  });

  it("strips zero-width space (U+200B)", () => {
    const input = "hello​world";
    const result = summarizeValue(input);
    expect(result).not.toContain("​");
    expect(result).toBe("helloworld");
  });

  it("strips zero-width non-joiner (U+200C)", () => {
    const result = summarizeValue("a‌b");
    expect(result).not.toContain("‌");
  });

  it("returns args... when only control/hidden chars remain", () => {
    expect(summarizeValue("\x1b[2J​\b")).toBe("args...");
  });

  it("handles mixed attack: ANSI + newlines + hidden chars", () => {
    const malicious = "\x1b[31mecho ok\x1b[0m\n\x1b]8;;http://x\x07fake\x1b]8;;\x07";
    const result = summarizeValue(malicious);
    expect(result).not.toContain("\x1b");
    expect(result).not.toContain("\n");
    expect(result).not.toContain("\x07");
    expect(result).toContain("echo ok");
  });
});
