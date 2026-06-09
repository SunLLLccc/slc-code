// OutputLine type system for the REPL UI
// Defines line types, tool call status, factory functions, and args parsing

import stripAnsi from "strip-ansi";
import { sanitizeUnicode } from "../security/unicode.js";

export interface ToolCallStatus {
  id: string;
  name: string;
  params: string;
  state: "pending" | "success" | "error";
  result?: string;
}

export interface OutputLine {
  type: "user" | "assistant" | "tool" | "command" | "error" | "system";
  content: string;
  timestamp: number;
  toolStatus?: ToolCallStatus;
}

// --- Factory functions ---

export function createUserLine(content: string): OutputLine {
  return { type: "user", content, timestamp: Date.now() };
}

export function createAssistantLine(content: string): OutputLine {
  return { type: "assistant", content, timestamp: Date.now() };
}

export function createToolLine(
  toolId: string,
  toolName: string,
  toolArgs: string,
): OutputLine {
  const params = parseToolArgsSummary(toolArgs, toolName);
  return {
    type: "tool",
    content: params,
    timestamp: Date.now(),
    toolStatus: {
      id: toolId,
      name: toolName,
      params,
      state: "pending",
    },
  };
}

export function createErrorLine(content: string): OutputLine {
  return { type: "error", content, timestamp: Date.now() };
}

export function createCommandLine(content: string): OutputLine {
  return { type: "command", content, timestamp: Date.now() };
}

export function createSystemLine(content: string): OutputLine {
  return { type: "system", content, timestamp: Date.now() };
}

// --- Tool status mutation helpers ---

export function updateToolStatus(
  line: OutputLine,
  state: "pending" | "success" | "error",
  result?: string,
): OutputLine {
  if (!line.toolStatus) return line;
  return {
    ...line,
    toolStatus: { ...line.toolStatus, state, result },
  };
}

export function updateToolParams(
  line: OutputLine,
  args: string,
): OutputLine {
  if (!line.toolStatus) return line;
  const summary = parseToolArgsSummary(args, line.toolStatus.name);
  // Only overwrite params if the new summary is meaningful (not the fallback)
  // or if the current params is empty
  const newParams =
    summary === "args..." && line.toolStatus.params ? line.toolStatus.params : summary;
  return {
    ...line,
    content: newParams,
    toolStatus: { ...line.toolStatus, params: newParams },
  };
}

// --- Args parsing ---

const MAX_SUMMARY_LENGTH = 60;

/**
 * Strip C0/C1 control characters, preserving \t which is handled separately.
 * Covers: backspace \b, DEL \x7f, C1 range \x80-\x9f, and other C0 except \t.
 */
function stripControlChars(text: string): string {
  // C0: \x00-\x08, \x0B-\x1f (skip \x09=\t, \x0A=\n, \x0D=\r — handled elsewhere)
  // C1: \x80-\x9f
  // DEL: \x7f
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]/g, "");
}

/**
 * Sanitize a raw value into a single-line, length-bounded summary.
 *
 * Pipeline:
 * 1. sanitizeUnicode — NFKC normalize + remove hidden/tag chars (zero-width, BOM, etc.)
 * 2. stripAnsi — remove all ANSI/OSC/CSI escape sequences
 * 3. stripControlChars — remove C0/C1 control chars (except \r\n\t)
 * 4. Normalize line endings: \r\n → \n, lone \r → \n
 * 5. Take first non-empty line (prevents newline injection)
 * 6. Replace \t with space, collapse whitespace
 * 7. Truncate to 60 chars
 * 8. Return "args..." if empty
 */
export function summarizeValue(value: string): string {
  // Step 1-3: security sanitization
  let s = sanitizeUnicode(value);
  s = stripAnsi(s);
  s = stripControlChars(s);

  // Step 4: normalize line endings
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Step 5: take first non-empty line
  const lines = s.split("\n");
  let firstLine = "";
  for (const line of lines) {
    if (line.trim()) {
      firstLine = line;
      break;
    }
  }

  if (!firstLine) return "args...";

  // Step 6: collapse tabs and whitespace
  firstLine = firstLine.replace(/\t/g, " ").replace(/\s+/g, " ").trim();

  if (!firstLine) return "args...";

  // Step 7: truncate
  if (firstLine.length > MAX_SUMMARY_LENGTH) {
    return firstLine.slice(0, MAX_SUMMARY_LENGTH) + "...";
  }
  return firstLine;
}

/**
 * Parse a tool_call_args JSON string into a human-readable summary.
 * Tool-specific extraction:
 *   - bash/Bash         → `command`
 *   - file_read/FileRead, file_write/FileWrite, file_edit/FileEdit → `path` or `file_path`
 *   - grep/Grep, glob/Glob → `pattern` or `query`
 *   - Fallback           → first string field
 *   - Parse failure      → "args..."
 *
 * All values go through summarizeValue: single-line, truncated to 60 chars.
 */
export function parseToolArgsSummary(args: string, toolName?: string): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(args);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return "args...";
    }
  } catch {
    return "args...";
  }

  const name = toolName?.toLowerCase() ?? "";

  // bash / Bash → command
  if (name === "bash") {
    const val = parsed.command;
    if (typeof val === "string") return summarizeValue(val);
  }

  // file_read / file_write / file_edit → path or file_path
  if (
    name === "file_read" || name === "fileread" ||
    name === "file_write" || name === "filewrite" ||
    name === "file_edit" || name === "fileedit"
  ) {
    const val = parsed.path ?? parsed.file_path;
    if (typeof val === "string") return summarizeValue(val);
  }

  // grep / glob → pattern or query
  if (name === "grep" || name === "glob") {
    const val = parsed.pattern ?? parsed.query;
    if (typeof val === "string") return summarizeValue(val);
  }

  // Fallback: first string field
  for (const value of Object.values(parsed)) {
    if (typeof value === "string") {
      return summarizeValue(value);
    }
  }

  return "args...";
}
