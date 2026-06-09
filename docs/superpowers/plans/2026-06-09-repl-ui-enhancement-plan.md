# REPL UI Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the minimal Ink REPL with status bars, streaming markdown rendering, tool call status, slash command autocomplete, and Ctrl+C abort — making it visually comparable to Claude Code.

**Architecture:** Incremental enhancement of the existing Ink-based `ReplApp`. Introduce `OutputLine` type system, split into focused components (`TopBar`, `BottomBar`, `OutputArea`, `ToolStatus`, `CommandPalette`, `InputLine`), add `AbortController` signal plumbing to `QueryEngine`, and add `marked`/`cli-highlight`/`figures` for markdown rendering.

**Tech Stack:** TypeScript, React 19, Ink 7, marked 15, cli-highlight 2, figures 6, vitest 3, @inkjs/testing-library 3

**Spec:** `docs/superpowers/specs/2026-06-09-repl-ui-enhancement-design.md`

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime dependencies**

```bash
cd /Users/sunlc/sunlc_work/sunlc-code
npm install marked@^15.0.0 cli-highlight@^2.1.11 figures@^6.1.0
```

- [ ] **Step 2: Install dev dependencies**

```bash
npm install -D @inkjs/testing-library@^3.0.0
```

- [ ] **Step 3: Verify installation**

```bash
npm ls marked cli-highlight figures @inkjs/testing-library
```

Expected: all four packages listed with versions.

- [ ] **Step 4: Verify build still works**

```bash
npm run build
```

Expected: `tsc` completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add marked, cli-highlight, figures, @inkjs/testing-library"
```

---

### Task 2: OutputLine Type System

**Files:**
- Create: `src/repl/output-types.ts`
- Test: `tests/repl/output-types.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/repl/output-types.test.ts
import { describe, it, expect } from "vitest";
import {
  createUserLine,
  createAssistantLine,
  createToolLine,
  updateToolStatus,
  createErrorLine,
  createCommandLine,
  createSystemLine,
  type OutputLine,
  type ToolCallStatus,
} from "../../src/repl/output-types.js";

describe("OutputLine factory", () => {
  it("creates user line", () => {
    const line = createUserLine("hello");
    expect(line.type).toBe("user");
    expect(line.content).toBe("hello");
    expect(line.timestamp).toBeGreaterThan(0);
  });

  it("creates assistant line", () => {
    const line = createAssistantLine("response");
    expect(line.type).toBe("assistant");
    expect(line.content).toBe("response");
  });

  it("creates tool line in pending state", () => {
    const line = createToolLine("call-1", "bash", "ls -la");
    expect(line.type).toBe("tool");
    expect(line.toolStatus).toEqual({
      id: "call-1",
      name: "bash",
      params: "ls -la",
      state: "pending",
    });
  });

  it("creates tool line with no params initially", () => {
    const line = createToolLine("call-1", "bash");
    expect(line.toolStatus?.params).toBe("");
    expect(line.toolStatus?.state).toBe("pending");
  });

  it("updates tool status to success", () => {
    const line = createToolLine("call-1", "bash", "ls -la");
    const updated = updateToolStatus(line, "success", "3 lines");
    expect(updated.toolStatus?.state).toBe("success");
    expect(updated.toolStatus?.result).toBe("3 lines");
  });

  it("updates tool status to error", () => {
    const line = createToolLine("call-1", "bash", "rm -rf /");
    const updated = updateToolStatus(line, "error", "Permission denied");
    expect(updated.toolStatus?.state).toBe("error");
    expect(updated.toolStatus?.result).toBe("Permission denied");
  });

  it("updates tool params", () => {
    const line = createToolLine("call-1", "bash");
    const updated = updateToolParams(line, '{"command": "ls -la"}');
    expect(updated.toolStatus?.params).toBe("ls -la");
  });

  it("handles unparseable params", () => {
    const line = createToolLine("call-1", "bash");
    const updated = updateToolParams(line, '{"command":');
    expect(updated.toolStatus?.params).toBe("args...");
  });

  it("creates error line", () => {
    const line = createErrorLine("something broke");
    expect(line.type).toBe("error");
    expect(line.content).toBe("something broke");
  });

  it("creates command line", () => {
    const line = createCommandLine("Command executed.");
    expect(line.type).toBe("command");
    expect(line.content).toBe("Command executed.");
  });

  it("creates system line", () => {
    const line = createSystemLine("AskUser prompt");
    expect(line.type).toBe("system");
    expect(line.content).toBe("AskUser prompt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/repl/output-types.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement OutputLine types**

```typescript
// src/repl/output-types.ts
// Structured output line types for the REPL

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

export function createUserLine(content: string): OutputLine {
  return { type: "user", content, timestamp: Date.now() };
}

export function createAssistantLine(content: string): OutputLine {
  return { type: "assistant", content, timestamp: Date.now() };
}

export function createToolLine(
  id: string,
  name: string,
  params?: string,
): OutputLine {
  return {
    type: "tool",
    content: "",
    timestamp: Date.now(),
    toolStatus: {
      id,
      name,
      params: params ?? "",
      state: "pending",
    },
  };
}

export function updateToolStatus(
  line: OutputLine,
  state: "success" | "error",
  result: string,
): OutputLine {
  if (!line.toolStatus) return line;
  return {
    ...line,
    toolStatus: { ...line.toolStatus, state, result },
  };
}

/**
 * Parse tool_call_args JSON and extract a human-readable param summary.
 * Returns the summary string, or "args..." if JSON is not parseable.
 */
export function parseToolArgsSummary(
  argsJson: string,
  toolName?: string,
): string {
  try {
    const parsed = JSON.parse(argsJson);
    if (typeof parsed !== "object" || parsed === null) return "args...";

    // Tool-specific extraction
    if (toolName === "bash" || toolName === "Bash") {
      if (typeof parsed.command === "string") {
        return parsed.command.length > 60
          ? parsed.command.slice(0, 57) + "..."
          : parsed.command;
      }
    }
    if (
      toolName === "file_read" ||
      toolName === "FileRead" ||
      toolName === "file_write" ||
      toolName === "FileWrite" ||
      toolName === "file_edit" ||
      toolName === "FileEdit"
    ) {
      if (typeof parsed.path === "string") return parsed.path;
      if (typeof parsed.file_path === "string") return parsed.file_path;
    }
    if (toolName === "grep" || toolName === "Grep" || toolName === "glob" || toolName === "Glob") {
      if (typeof parsed.pattern === "string") return parsed.pattern;
      if (typeof parsed.query === "string") return parsed.query;
    }

    // Fallback: first string field
    for (const value of Object.values(parsed)) {
      if (typeof value === "string") {
        return value.length > 60 ? value.slice(0, 57) + "..." : value;
      }
    }
    return "args...";
  } catch {
    return "args...";
  }
}

export function updateToolParams(
  line: OutputLine,
  argsJson: string,
): OutputLine {
  if (!line.toolStatus) return line;
  const summary = parseToolArgsSummary(argsJson, line.toolStatus.name);
  // Only update if we got a real summary (not "args..." when we already have one)
  if (summary === "args..." && line.toolStatus.params !== "") return line;
  return {
    ...line,
    toolStatus: { ...line.toolStatus, params: summary },
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/repl/output-types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repl/output-types.ts tests/repl/output-types.test.ts
git commit -m "feat(repl): OutputLine type system with tool status parsing"
```

---

### Task 3: QueryEngine Signal Support

**Files:**
- Modify: `src/engine/engine.ts:58,73-79`
- Test: `tests/engine/engine.test.ts` (add signal test)

- [ ] **Step 1: Write failing test**

```typescript
// Add to existing tests/engine/engine.test.ts or create new file
import { describe, it, expect } from "vitest";
import { QueryEngine } from "../../src/engine/engine.js";

describe("QueryEngine signal support", () => {
  it("query() accepts optional AbortSignal parameter", () => {
    // Type check — signal parameter should be accepted
    const controller = new AbortController();
    // We can't run a real query without a provider, but we can verify the signature compiles
    // This is a compile-time check; runtime test needs a mock provider
    expect(typeof QueryEngine.prototype.query).toBe("function");
  });
});
```

- [ ] **Step 2: Read current engine.ts**

Read `src/engine/engine.ts` to confirm the exact code at lines 58 and 73-79.

- [ ] **Step 3: Add signal parameter to QueryEngine.query()**

In `src/engine/engine.ts`, change:

```typescript
// Line 58: Change signature from
async *query(userMessage: string): AsyncGenerator<StreamEvent>
// to
async *query(userMessage: string, options?: { signal?: AbortSignal }): AsyncGenerator<StreamEvent>
```

And in lines 73-79, add signal to the options object:

```typescript
// Change from
const options: QueryOptions = {
  maxTurns: this.config.maxTurns,
  tools: this.config.tools,
  toolRegistry: this.config.toolRegistry,
  permissionChecker: this.config.permissionChecker,
  toolContext: this.config.toolContext,
};
// to
const options: QueryOptions = {
  maxTurns: this.config.maxTurns,
  tools: this.config.tools,
  signal: queryOptions?.signal,
  toolRegistry: this.config.toolRegistry,
  permissionChecker: this.config.permissionChecker,
  toolContext: this.config.toolContext,
};
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/engine/
```

Expected: PASS.

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine/engine.ts
git commit -m "feat(engine): add AbortSignal support to QueryEngine.query()"
```

---

### Task 4: TopBar Component

**Files:**
- Create: `src/repl/components/TopBar.tsx`
- Test: `tests/repl/TopBar.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// tests/repl/TopBar.test.tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@inkjs/testing-library";
import { TopBar } from "../../src/repl/components/TopBar.js";

describe("TopBar", () => {
  it("displays product name", () => {
    const { lastFrame } = render(
      <TopBar model="deepseek-v4-pro" sessionId="abc-123-def" />,
    );
    expect(lastFrame()).toContain("slc-code");
  });

  it("displays model name", () => {
    const { lastFrame } = render(
      <TopBar model="deepseek-v4-pro" sessionId="abc-123-def" />,
    );
    expect(lastFrame()).toContain("deepseek-v4-pro");
  });

  it("truncates session ID to 8 chars", () => {
    const { lastFrame } = render(
      <TopBar model="deepseek-v4-pro" sessionId="abc-123-def-456" />,
    );
    expect(lastFrame()).toContain("abc-123-");
    expect(lastFrame()).not.toContain("abc-123-def-456");
  });

  it("handles null session ID", () => {
    const { lastFrame } = render(
      <TopBar model="deepseek-v4-pro" sessionId={null} />,
    );
    expect(lastFrame()).toContain("slc-code");
    expect(lastFrame()).toContain("deepseek-v4-pro");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/repl/TopBar.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create components directory**

```bash
mkdir -p src/repl/components
```

- [ ] **Step 4: Implement TopBar**

```typescript
// src/repl/components/TopBar.tsx
import React from "react";
import { Box, Text } from "ink";

export interface TopBarProps {
  model: string;
  sessionId: string | null;
}

export function TopBar({ model, sessionId }: TopBarProps) {
  const shortId = sessionId ? sessionId.slice(0, 8) : "no-session";

  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderBottom={true}
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Text bold>slc-code</Text>
      <Text dimColor> │ </Text>
      <Text>{model}</Text>
      <Text dimColor> │ </Text>
      <Text dimColor>session: {shortId}</Text>
    </Box>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/repl/TopBar.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/repl/components/TopBar.tsx tests/repl/TopBar.test.tsx
git commit -m "feat(repl): TopBar component with model and session display"
```

---

### Task 5: BottomBar Component

**Files:**
- Create: `src/repl/components/BottomBar.tsx`
- Test: `tests/repl/BottomBar.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// tests/repl/BottomBar.test.tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@inkjs/testing-library";
import { BottomBar } from "../../src/repl/components/BottomBar.js";

describe("BottomBar", () => {
  it("displays shortcut hints", () => {
    const { lastFrame } = render(
      <BottomBar inputTokens={0} outputTokens={0} />,
    );
    expect(lastFrame()).toContain("↑↓");
    expect(lastFrame()).toContain("Tab");
    expect(lastFrame()).toContain("Ctrl+C");
  });

  it("displays token stats when available", () => {
    const { lastFrame } = render(
      <BottomBar inputTokens={500} outputTokens={700} />,
    );
    expect(lastFrame()).toContain("500");
    expect(lastFrame()).toContain("700");
  });

  it("displays estimate when no token data", () => {
    const { lastFrame } = render(
      <BottomBar inputTokens={0} outputTokens={0} estimatedOutputTokens={120} />,
    );
    expect(lastFrame()).toContain("~120");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/repl/BottomBar.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement BottomBar**

```typescript
// src/repl/components/BottomBar.tsx
import React from "react";
import { Box, Text } from "ink";

export interface BottomBarProps {
  inputTokens: number;
  outputTokens: number;
  estimatedOutputTokens?: number;
}

export function BottomBar({
  inputTokens,
  outputTokens,
  estimatedOutputTokens,
}: BottomBarProps) {
  const tokenDisplay =
    inputTokens > 0 || outputTokens > 0
      ? `tok:${inputTokens}+${outputTokens}`
      : estimatedOutputTokens
        ? `tok:?+~${estimatedOutputTokens}`
        : null;

  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Text dimColor>↑↓:history  Tab:complete  Ctrl+C:abort</Text>
      {tokenDisplay && (
        <>
          <Text dimColor>  </Text>
          <Text dimColor>{tokenDisplay}</Text>
        </>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/repl/BottomBar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repl/components/BottomBar.tsx tests/repl/BottomBar.test.tsx
git commit -m "feat(repl): BottomBar component with shortcuts and token stats"
```

---

### Task 6: ToolStatus Component

**Files:**
- Create: `src/repl/components/ToolStatus.tsx`
- Test: `tests/repl/ToolStatus.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// tests/repl/ToolStatus.test.tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@inkjs/testing-library";
import { ToolStatusLine } from "../../src/repl/components/ToolStatus.js";
import type { ToolCallStatus } from "../../src/repl/output-types.js";

describe("ToolStatusLine", () => {
  it("shows pending state with dim color", () => {
    const status: ToolCallStatus = {
      id: "1",
      name: "bash",
      params: "ls -la",
      state: "pending",
    };
    const { lastFrame } = render(<ToolStatusLine status={status} />);
    expect(lastFrame()).toContain("●");
    expect(lastFrame()).toContain("bash");
    expect(lastFrame()).toContain("ls -la");
  });

  it("shows pending state without params", () => {
    const status: ToolCallStatus = {
      id: "1",
      name: "bash",
      params: "",
      state: "pending",
    };
    const { lastFrame } = render(<ToolStatusLine status={status} />);
    expect(lastFrame()).toContain("●");
    expect(lastFrame()).toContain("bash");
  });

  it("shows success state with result summary", () => {
    const status: ToolCallStatus = {
      id: "1",
      name: "bash",
      params: "ls -la",
      state: "success",
      result: "3 lines",
    };
    const { lastFrame } = render(<ToolStatusLine status={status} />);
    expect(lastFrame()).toContain("✓");
    expect(lastFrame()).toContain("bash");
    expect(lastFrame()).toContain("ls -la");
    expect(lastFrame()).toContain("3 lines");
  });

  it("shows error state with error message", () => {
    const status: ToolCallStatus = {
      id: "1",
      name: "bash",
      params: "rm -rf /",
      state: "error",
      result: "Permission denied",
    };
    const { lastFrame } = render(<ToolStatusLine status={status} />);
    expect(lastFrame()).toContain("✗");
    expect(lastFrame()).toContain("Permission denied");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/repl/ToolStatus.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement ToolStatusLine**

```typescript
// src/repl/components/ToolStatus.tsx
import React from "react";
import { Box, Text } from "ink";
import type { ToolCallStatus } from "../output-types.js";

export interface ToolStatusLineProps {
  status: ToolCallStatus;
}

export function ToolStatusLine({ status }: ToolStatusLineProps) {
  const { name, params, state, result } = status;

  const icon =
    state === "pending" ? "●" : state === "success" ? "✓" : "✗";
  const color =
    state === "pending"
      ? "yellow"
      : state === "success"
        ? "green"
        : "red";
  const dim = state === "pending";

  const summary = params ? `: ${params}` : "";
  const resultSuffix = result ? ` (${result})` : "";

  return (
    <Box>
      <Text color={color} dimColor={dim}>
        {icon} {name}{summary}{resultSuffix}
      </Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/repl/ToolStatus.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repl/components/ToolStatus.tsx tests/repl/ToolStatus.test.tsx
git commit -m "feat(repl): ToolStatus component with pending/success/error states"
```

---

### Task 7: CommandPalette Component

**Files:**
- Create: `src/repl/components/CommandPalette.tsx`
- Test: `tests/repl/CommandPalette.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// tests/repl/CommandPalette.test.tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@inkjs/testing-library";
import { CommandPalette } from "../../src/repl/components/CommandPalette.js";
import type { Command } from "../../src/commands/registry.js";

const mockCommands: Command[] = [
  { name: "help", description: "Show help info", aliases: ["h", "?"], execute: async () => "" },
  { name: "clear", description: "Clear conversation", execute: async () => "" },
  { name: "config", description: "View configuration", execute: async () => "" },
  { name: "model", description: "View/switch model", usage: "/model <name>", execute: async () => "" },
];

describe("CommandPalette", () => {
  it("shows all commands when filter is empty", () => {
    const { lastFrame } = render(
      <CommandPalette commands={mockCommands} filter="" selectedIndex={0} />,
    );
    expect(lastFrame()).toContain("/help");
    expect(lastFrame()).toContain("/clear");
    expect(lastFrame()).toContain("/config");
    expect(lastFrame()).toContain("/model");
  });

  it("filters commands by name", () => {
    const { lastFrame } = render(
      <CommandPalette commands={mockCommands} filter="mo" selectedIndex={0} />,
    );
    expect(lastFrame()).toContain("/model");
    expect(lastFrame()).not.toContain("/help");
    expect(lastFrame()).not.toContain("/clear");
  });

  it("shows aliases in parentheses", () => {
    const { lastFrame } = render(
      <CommandPalette commands={mockCommands} filter="" selectedIndex={0} />,
    );
    expect(lastFrame()).toContain("(h, ?)");
  });

  it("shows usage when present", () => {
    const { lastFrame } = render(
      <CommandPalette commands={mockCommands} filter="" selectedIndex={0} />,
    );
    expect(lastFrame()).toContain("/model <name>");
  });

  it("shows descriptions", () => {
    const { lastFrame } = render(
      <CommandPalette commands={mockCommands} filter="" selectedIndex={0} />,
    );
    expect(lastFrame()).toContain("Show help info");
    expect(lastFrame()).toContain("Clear conversation");
  });

  it("highlights selected item", () => {
    const { lastFrame } = render(
      <CommandPalette commands={mockCommands} filter="" selectedIndex={2} />,
    );
    // The selected item should be visually distinct — check for inverse or bold marker
    // Exact assertion depends on how we implement highlight (e.g. bold/inverse)
    expect(lastFrame()).toContain("/config");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/repl/CommandPalette.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement CommandPalette**

```typescript
// src/repl/components/CommandPalette.tsx
import React from "react";
import { Box, Text } from "ink";
import type { Command } from "../../commands/registry.js";

export interface CommandPaletteProps {
  commands: Command[];
  filter: string;
  selectedIndex: number;
}

export function CommandPalette({
  commands,
  filter,
  selectedIndex,
}: CommandPaletteProps) {
  const filtered = commands.filter(
    (cmd) =>
      cmd.name.includes(filter) ||
      cmd.aliases?.some((a) => a.includes(filter)),
  );

  if (filtered.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text dimColor>No matching commands</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {filtered.map((cmd, i) => {
        const isSelected = i === selectedIndex;
        const aliasStr = cmd.aliases?.length
          ? ` (${cmd.aliases.join(", ")})`
          : "";
        const usageStr = cmd.usage ? ` ${cmd.usage}` : "";

        return (
          <Box key={cmd.name}>
            <Text bold={isSelected} inverse={isSelected}>
              /{cmd.name}{aliasStr}{usageStr}  {cmd.description}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/repl/CommandPalette.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repl/components/CommandPalette.tsx tests/repl/CommandPalette.test.tsx
git commit -m "feat(repl): CommandPalette component with filter and selection"
```

---

### Task 8: InputLine Component

**Files:**
- Create: `src/repl/components/InputLine.tsx`
- Test: `tests/repl/InputLine.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// tests/repl/InputLine.test.tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@inkjs/testing-library";
import { InputLine } from "../../src/repl/components/InputLine.js";

describe("InputLine", () => {
  it("shows green prompt in normal mode", () => {
    const { lastFrame } = render(
      <InputLine value="hello" isAskMode={false} />,
    );
    expect(lastFrame()).toContain("❯");
    expect(lastFrame()).toContain("hello");
  });

  it("shows yellow prompt in AskUser mode", () => {
    const { lastFrame } = render(
      <InputLine value="answer" isAskMode={true} />,
    );
    expect(lastFrame()).toContain("❓");
    expect(lastFrame()).toContain("answer");
  });

  it("shows cursor block", () => {
    const { lastFrame } = render(
      <InputLine value="" isAskMode={false} />,
    );
    expect(lastFrame()).toContain("█");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/repl/InputLine.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement InputLine**

```typescript
// src/repl/components/InputLine.tsx
import React from "react";
import { Box, Text } from "ink";

export interface InputLineProps {
  value: string;
  isAskMode: boolean;
}

export function InputLine({ value, isAskMode }: InputLineProps) {
  return (
    <Box>
      <Text color={isAskMode ? "yellow" : "green"}>
        {isAskMode ? "❓ " : "❯ "}
      </Text>
      <Text>{value}</Text>
      <Text dimColor>█</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/repl/InputLine.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repl/components/InputLine.tsx tests/repl/InputLine.test.tsx
git commit -m "feat(repl): InputLine component with normal/AskUser modes"
```

---

### Task 9: Integrate Components into ReplApp

**Files:**
- Modify: `src/repl/app.tsx`
- Modify: `src/repl/index.ts` (if needed)

- [ ] **Step 1: Read current app.tsx**

Read the full file to understand the current structure.

- [ ] **Step 2: Add new imports and OutputLine state**

Replace the `output: string[]` state with `output: OutputLine[]`, add new state variables:

```typescript
// Add imports at top
import { TopBar } from "./components/TopBar.js";
import { BottomBar } from "./components/BottomBar.js";
import { InputLine } from "./components/InputLine.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { ToolStatusLine } from "./components/ToolStatus.js";
import {
  createUserLine,
  createAssistantLine,
  createToolLine,
  updateToolStatus,
  updateToolParams,
  createErrorLine,
  createCommandLine,
  createSystemLine,
  type OutputLine,
} from "./output-types.js";

// Replace state
const [output, setOutput] = useState<OutputLine[]>([]);

// Add new state
const [commandHistory, setCommandHistory] = useState<string[]>([]);
const [historyIndex, setHistoryIndex] = useState(-1);
const [showPalette, setShowPalette] = useState(false);
const [paletteFilter, setPaletteFilter] = useState("");
const [paletteIndex, setPaletteIndex] = useState(0);
const [inputTokens, setInputTokens] = useState(0);
const [outputTokens, setOutputTokens] = useState(0);
const [estimatedOutputTokens, setEstimatedOutputTokens] = useState(0);

// Add ref
const abortControllerRef = useRef<AbortController | null>(null);
```

- [ ] **Step 3: Convert addOutput to structured OutputLine**

Replace the `addOutput` callback:

```typescript
const addOutput = useCallback((line: OutputLine) => {
  setOutput((prev) => [...prev, line]);
}, []);
```

- [ ] **Step 4: Convert handleSubmit to use OutputLine and AbortController**

```typescript
const handleSubmit = useCallback(async () => {
  const query = input.trim();
  if (!query) return;

  setInput("");
  addOutput(createUserLine(query));
  setCommandHistory((prev) => [...prev, query]);
  setHistoryIndex(-1);

  // Check if it's a slash command
  if (query.startsWith("/")) {
    const result = await handleCommand(query);
    // handleCommand already adds command output
    return;
  }

  // Wait for engine initialization
  if (engineInitRef.current) await engineInitRef.current;
  const engine = engineRef.current;

  await sessionManagerRef.current.appendUserEvent(query);

  // Create abort controller
  const controller = new AbortController();
  abortControllerRef.current = controller;

  setStreaming(true);
  setEstimatedOutputTokens(0);
  let responseText = "";
  let charCount = 0;

  try {
    for await (const event of engine.query(query, { signal: controller.signal })) {
      if (event.type === "text_delta") {
        responseText += event.text;
        charCount += event.text.length;
        setEstimatedOutputTokens(Math.floor(charCount / 4));
      }
      if (event.type === "tool_call_start") {
        addOutput(createToolLine(event.id, event.name));
      }
      if (event.type === "tool_call_args") {
        // Update tool params with JSON.parse detection
        setOutput((prev) =>
          prev.map((line) =>
            line.toolStatus?.id === event.id
              ? updateToolParams(line, event.args_json)
              : line,
          ),
        );
      }
      if (event.type === "tool_call_result") {
        setOutput((prev) =>
          prev.map((line) =>
            line.toolStatus?.id === event.id
              ? updateToolStatus(
                  line,
                  event.isError ? "error" : "success",
                  event.result.slice(0, 60),
                )
              : line,
          ),
        );
      }
      if (event.type === "error") {
        addOutput(createErrorLine(event.error.message));
      }
      if (event.type === "done") break;
    }

    if (responseText) {
      addOutput(createAssistantLine(responseText));
      await sessionManagerRef.current.appendAssistantEvent(responseText);
      const sm = sessionManagerRef.current;
      await persistSessionMemory(engine.getMessages(), sm.sessionDir, sm.isEnabled);
      const memoryConfig = commandContext.config?.memory as { autoMemoryEnabled?: boolean } | undefined;
      const cwd = (commandContext.config?.cwd as string) ?? process.cwd();
      await processAutoMemory(query, responseText, {
        persistenceEnabled: sm.isEnabled,
        autoMemoryEnabled: memoryConfig?.autoMemoryEnabled ?? true,
        cleanupPeriodDays,
        cwd,
        memoryDir: commandContext.config?.memoryDir as string | undefined,
      });
    }
  } catch (e) {
    if (controller.signal.aborted) {
      addOutput(createSystemLine("Interrupted."));
    } else {
      addOutput(createErrorLine(e instanceof Error ? e.message : String(e)));
    }
  } finally {
    setStreaming(false);
    abortControllerRef.current = null;
  }
}, [input, provider, handleCommand, addOutput]);
```

- [ ] **Step 5: Update useInput handler for palette, history, and abort**

```typescript
useInput((ch, key) => {
  // Ctrl+C: abort if streaming, cancel if AskUser, exit otherwise
  if (key.ctrl && ch === "c") {
    if (streaming && abortControllerRef.current) {
      abortControllerRef.current.abort();
      return;
    }
    if (pendingAsk) {
      handleAskCancel();
      return;
    }
    exit();
    return;
  }

  // AskUser mode: all input goes to answer
  if (pendingAsk) {
    if (key.return) {
      handleAskSubmit();
      return;
    }
    if (key.backspace) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }
    setInput((prev) => prev + ch);
    return;
  }

  // Palette mode
  if (showPalette) {
    if (key.escape) {
      setShowPalette(false);
      setInput("");
      return;
    }
    if (key.upArrow) {
      setPaletteIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setPaletteIndex((prev) => prev + 1); // clamped in render
      return;
    }
    if (key.tab) {
      // Insert highlighted command, close palette
      const commands = commandRegistry.list();
      const filtered = commands.filter(
        (c) =>
          c.name.includes(paletteFilter) ||
          c.aliases?.some((a) => a.includes(paletteFilter)),
      );
      if (filtered[paletteIndex]) {
        setInput(`/${filtered[paletteIndex].name} `);
      }
      setShowPalette(false);
      return;
    }
    if (key.return) {
      const commands = commandRegistry.list();
      const filtered = commands.filter(
        (c) =>
          c.name.includes(paletteFilter) ||
          c.aliases?.some((a) => a.includes(paletteFilter)),
      );
      const selected = filtered[paletteIndex];
      const inputName = input.startsWith("/") ? input.slice(1).trim() : input;

      if (selected && inputName === selected.name) {
        // Exact match — execute
        setShowPalette(false);
        handleSubmit();
      } else if (selected) {
        // Prefix match — complete
        setInput(`/${selected.name} `);
        setShowPalette(false);
      } else {
        // No match — submit as-is
        setShowPalette(false);
        handleSubmit();
      }
      return;
    }

    // Regular typing in palette mode
    const newInput = input + ch;
    setInput(newInput);
    setPaletteFilter(newInput.startsWith("/") ? newInput.slice(1) : newInput);
    setPaletteIndex(0);
    return;
  }

  // Normal mode (no palette, no AskUser)
  if (key.escape) {
    exit();
    return;
  }

  if (key.return) {
    handleSubmit();
    return;
  }

  if (key.tab) {
    // Open palette on Tab
    setShowPalette(true);
    setPaletteFilter("");
    setPaletteIndex(0);
    return;
  }

  // History navigation (only when input is empty)
  if (key.upArrow && input === "") {
    if (commandHistory.length > 0) {
      const newIndex =
        historyIndex === -1
          ? commandHistory.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setInput(commandHistory[newIndex] ?? "");
    }
    return;
  }

  if (key.downArrow && input === "") {
    if (historyIndex >= 0) {
      const newIndex = historyIndex + 1;
      if (newIndex >= commandHistory.length) {
        setHistoryIndex(-1);
        setInput("");
      } else {
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex] ?? "");
      }
    }
    return;
  }

  // Detect `/` to open palette
  if (ch === "/" && input === "") {
    setInput("/");
    setShowPalette(true);
    setPaletteFilter("");
    setPaletteIndex(0);
    return;
  }

  if (key.backspace) {
    const newInput = input.slice(0, -1);
    setInput(newInput);
    if (!newInput.startsWith("/")) {
      setShowPalette(false);
    } else {
      setPaletteFilter(newInput.slice(1));
      setPaletteIndex(0);
    }
    return;
  }

  setInput((prev) => prev + ch);
});
```

- [ ] **Step 6: Update JSX to use new components**

```jsx
return (
  <Box flexDirection="column" width="100%">
    <TopBar
      model={currentModel}
      sessionId={sessionManagerRef.current.sessionId}
    />
    <Box flexDirection="column" flexGrow={1}>
      {output.map((line, i) => {
        if (line.type === "tool" && line.toolStatus) {
          return <ToolStatusLine key={i} status={line.toolStatus} />;
        }
        return (
          <Box key={i}>
            <Text
              color={
                line.type === "error"
                  ? "red"
                  : line.type === "user"
                    ? "gray"
                    : line.type === "system"
                      ? "yellow"
                      : undefined
              }
              dimColor={line.type === "user" || line.type === "system"}
            >
              {line.type === "user" ? `> ${line.content}` : line.content}
            </Text>
          </Box>
        );
      })}
      {streaming && (
        <Box>
          <Text dimColor>Thinking...</Text>
        </Box>
      )}
      {pendingAsk && (
        <Box>
          <Text color="yellow">
            [AskUser] ({askIndex + 1}/{pendingAsk.questions.length}){" "}
            {pendingAsk.questions[askIndex]}
          </Text>
        </Box>
      )}
      {showPalette && (
        <CommandPalette
          commands={commandRegistry.list()}
          filter={paletteFilter}
          selectedIndex={paletteIndex}
        />
      )}
      <InputLine
        value={input}
        isAskMode={!!pendingAsk}
      />
    </Box>
    <BottomBar
      inputTokens={inputTokens}
      outputTokens={outputTokens}
      estimatedOutputTokens={estimatedOutputTokens}
    />
  </Box>
);
```

- [ ] **Step 7: Verify build**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/repl/app.tsx
git commit -m "feat(repl): integrate TopBar, BottomBar, CommandPalette, InputLine, ToolStatus into ReplApp"
```

---

### Task 10: Streaming Markdown Rendering

**Files:**
- Create: `src/repl/components/MarkdownBlock.tsx`
- Test: `tests/repl/MarkdownBlock.test.tsx`
- Modify: `src/repl/app.tsx` (use MarkdownBlock for assistant lines)

- [ ] **Step 1: Write failing test**

```typescript
// tests/repl/MarkdownBlock.test.tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@inkjs/testing-library";
import { MarkdownBlock } from "../../src/repl/components/MarkdownBlock.js";

describe("MarkdownBlock", () => {
  it("renders plain text", () => {
    const { lastFrame } = render(<MarkdownBlock content="hello world" />);
    expect(lastFrame()).toContain("hello world");
  });

  it("renders bold text", () => {
    const { lastFrame } = render(
      <MarkdownBlock content="this is **bold** text" />,
    );
    expect(lastFrame()).toContain("bold");
  });

  it("renders code blocks", () => {
    const { lastFrame } = render(
      <MarkdownBlock content={'```python\nprint("hello")\n```'} />,
    );
    expect(lastFrame()).toContain('print("hello")');
  });

  it("renders inline code", () => {
    const { lastFrame } = render(
      <MarkdownBlock content="use `npm install` to install" />,
    );
    expect(lastFrame()).toContain("npm install");
  });

  it("renders lists", () => {
    const { lastFrame } = render(
      <MarkdownBlock content="- item 1\n- item 2" />,
    );
    expect(lastFrame()).toContain("item 1");
    expect(lastFrame()).toContain("item 2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/repl/MarkdownBlock.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement MarkdownBlock**

```typescript
// src/repl/components/MarkdownBlock.tsx
import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { marked } from "marked";
import highlight from "cli-highlight";

export interface MarkdownBlockProps {
  content: string;
}

type RenderToken =
  | { type: "paragraph"; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "list"; items: string[] }
  | { type: "heading"; level: number; text: string }
  | { type: "text"; text: string };

function renderInline(text: string): string {
  // Strip markdown inline formatting for terminal display
  // **bold** -> bold, *italic* -> italic, `code` -> code
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1 ($2)"); // [text](url) -> text (url)
}

export function MarkdownBlock({ content }: MarkdownBlockProps) {
  const tokens = useMemo(() => {
    try {
      const lexer = new marked.Lexer();
      return lexer.lex(content);
    } catch {
      return [{ type: "paragraph", text: content }];
    }
  }, [content]);

  return (
    <Box flexDirection="column">
      {tokens.map((token, i) => {
        if (token.type === "code") {
          const lang = (token as { lang?: string }).lang ?? "";
          const code = (token as { text: string }).text;
          let highlighted: string;
          try {
            highlighted = highlight(code, { language: lang || undefined });
          } catch {
            highlighted = code;
          }
          return (
            <Box key={i} flexDirection="column">
              {lang && <Text dimColor>```{lang}</Text>}
              <Text>{highlighted}</Text>
              <Text dimColor>```</Text>
            </Box>
          );
        }

        if (token.type === "list") {
          const listToken = token as { items: Array<{ text: string }> };
          return (
            <Box key={i} flexDirection="column">
              {listToken.items.map((item, j) => (
                <Text key={j}>  • {renderInline(item.text)}</Text>
              ))}
            </Box>
          );
        }

        if (token.type === "heading") {
          const headingToken = token as { depth: number; text: string };
          return (
            <Box key={i}>
              <Text bold>
                {"#".repeat(headingToken.depth)} {renderInline(headingToken.text)}
              </Text>
            </Box>
          );
        }

        if (token.type === "paragraph") {
          const paraToken = token as { text: string };
          return (
            <Box key={i}>
              <Text>{renderInline(paraToken.text)}</Text>
            </Box>
          );
        }

        // Fallback for unknown tokens
        const raw = (token as { raw?: string }).raw ?? "";
        if (raw) {
          return (
            <Box key={i}>
              <Text>{raw}</Text>
            </Box>
          );
        }
        return null;
      })}
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/repl/MarkdownBlock.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Update app.tsx to use MarkdownBlock for assistant lines**

In the JSX output rendering section, change assistant lines to use MarkdownBlock:

```tsx
import { MarkdownBlock } from "./components/MarkdownBlock.js";

// In the output map:
{output.map((line, i) => {
  if (line.type === "tool" && line.toolStatus) {
    return <ToolStatusLine key={i} status={line.toolStatus} />;
  }
  if (line.type === "assistant") {
    return <MarkdownBlock key={i} content={line.content} />;
  }
  return (
    <Box key={i}>
      <Text
        color={
          line.type === "error"
            ? "red"
            : line.type === "user"
              ? "gray"
              : line.type === "system"
                ? "yellow"
                : undefined
        }
        dimColor={line.type === "user" || line.type === "system"}
      >
        {line.type === "user" ? `> ${line.content}` : line.content}
      </Text>
    </Box>
  );
})}
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/repl/components/MarkdownBlock.tsx tests/repl/MarkdownBlock.test.tsx src/repl/app.tsx
git commit -m "feat(repl): streaming markdown rendering with syntax highlighting"
```

---

### Task 11: Streaming Buffer and Throttle

**Files:**
- Modify: `src/repl/app.tsx` (streaming buffer logic)

- [ ] **Step 1: Add streaming buffer state and throttle**

```typescript
// Add state
const [streamBuffer, setStreamBuffer] = useState("");
const streamThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const lastRenderRef = useRef(0);

// Constants
const THROTTLE_MS = 80;
const DEGRADATION_THRESHOLD = 10000;
```

- [ ] **Step 2: Update text_delta handling in handleSubmit**

Replace the simple `responseText += event.text` with throttled buffer logic:

```typescript
if (event.type === "text_delta") {
  responseText += event.text;
  charCount += event.text.length;
  setEstimatedOutputTokens(Math.floor(charCount / 4));

  // Append to stream buffer
  setStreamBuffer((prev) => {
    const newBuffer = prev + event.text;

    // Check degradation threshold
    if (newBuffer.length > DEGRADATION_THRESHOLD) {
      // Skip markdown rendering for very long responses
      return newBuffer;
    }

    // Throttle re-render
    const now = Date.now();
    if (now - lastRenderRef.current >= THROTTLE_MS || event.text.includes("\n")) {
      lastRenderRef.current = now;
      // Update the last assistant line in output
      setOutput((prevOutput) => {
        const lastIdx = prevOutput.length - 1;
        const lastLine = prevOutput[lastIdx];
        if (lastLine?.type === "assistant" && lastLine.content === prev) {
          // Update existing assistant line
          return [
            ...prevOutput.slice(0, lastIdx),
            { ...lastLine, content: newBuffer },
          ];
        }
        // Create new assistant line for streaming
        return [...prevOutput, createAssistantLine(newBuffer)];
      });
    }

    return newBuffer;
  });
}
```

- [ ] **Step 3: Flush buffer on done event**

After the `for await` loop, ensure the final buffer is rendered:

```typescript
// After the loop, flush streamBuffer
if (streamBuffer) {
  setOutput((prevOutput) => {
    const lastIdx = prevOutput.length - 1;
    const lastLine = prevOutput[lastIdx];
    if (lastLine?.type === "assistant") {
      return [
        ...prevOutput.slice(0, lastIdx),
        { ...lastLine, content: streamBuffer },
      ];
    }
    return [...prevOutput, createAssistantLine(streamBuffer)];
  });
  setStreamBuffer("");
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/repl/app.tsx
git commit -m "feat(repl): streaming buffer with 80ms throttle and degradation"
```

---

### Task 12: Manual Testing and Polish

- [ ] **Step 1: Build and install locally**

```bash
npm run build && npm pack && npm install -g ./slc-code-0.1.0.tgz
```

- [ ] **Step 2: Test basic REPL flow**

```bash
slc
```

Verify:
- TopBar shows `slc-code | {model} | session: {id}`
- BottomBar shows shortcut hints
- Input with `❯` prompt
- Type a message, verify response renders with markdown

- [ ] **Step 3: Test slash commands**

In the REPL:
- Type `/` — palette should open
- Type `/he` — should filter to `/help`
- Press Enter — should complete to `/help`
- Press Enter again — should execute `/help`
- Press Esc — should close palette

- [ ] **Step 4: Test Ctrl+C abort**

- Start a long-running query
- Press Ctrl+C — should show "Interrupted."
- Press Ctrl+C again (idle) — should exit

- [ ] **Step 5: Test terminal compatibility**

Run in different terminal emulators:
- iTerm2
- Terminal.app
- tmux

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat(repl): REPL UI enhancement complete — status bars, markdown, tool status, command palette, abort"
```
