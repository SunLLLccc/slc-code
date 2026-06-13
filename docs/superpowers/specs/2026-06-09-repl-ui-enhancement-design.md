# REPL UI Enhancement Design

**Date:** 2026-06-09
**Status:** Draft
**Scope:** Claude Code-like terminal UI with status bars, streaming markdown, tool status, slash command autocomplete

## Overview

Enhance the minimal Ink REPL to provide a rich terminal UI experience similar to Claude Code, with status bars, real-time markdown rendering, tool call status display, and slash command autocomplete.

## Layout

```
┌─────────────────────────────────────────────┐
│  slc-code │ deepseek-v4-pro │ session: abc123 │  ← TopBar
├─────────────────────────────────────────────┤
│                                             │
│  > 用户输入的内容                            │
│                                             │
│  ▶ bash: ls -la                             │  ← Tool status
│  ✓ bash 完成 (3 行输出)                      │
│                                             │
│  这是 LLM 的 **markdown** 输出               │
│  ```python                                  │
│  def hello():                               │
│      print("world")                         │
│  ```                                        │
│                                             │
│  ❯ /he█                                     │  ← Input line
│  ┌────────────────────┐                     │
│  │ /help   (h, ?)     │                     │
│  │ /clear              │  ← Command palette  │
│  └────────────────────┘                     │
├─────────────────────────────────────────────┤
│  ↑↓:history  Tab:complete  Ctrl+C:abort  tok:1.2k│ ← BottomBar
└─────────────────────────────────────────────┘
```

## Components

### 1. TopBar

- **Position:** Top of screen
- **Content:** Product name (`slc-code`), model name, session ID (short hash)
- **Style:** Dim/inverted background, single line, separator `│` between items
- **Dynamic:** Updates when model changes (`/model` command)

### 2. OutputArea

- **Position:** Middle of screen, scrollable
- **Content:** All output lines — user input echo, LLM responses, tool status, command results, AskUser prompts/answers
- **Rendering:** Each line rendered based on `OutputLine.type`:
  - `user`: `> ` prefix, dim color
  - `assistant`: Markdown parsed and rendered with syntax highlighting
  - `tool`: Inline status indicators (see ToolStatus)
  - `command`: Plain text
  - `error`: Red color
  - `system`: Dim color (AskUser prompts, system messages)
- **Scrolling:** Manual scroll via `Page Up` / `Page Down`, `Ctrl+L` to jump to bottom. Auto-scroll on new output unless user has scrolled up.

### 3. ToolStatus

#### Event Mapping (aligned with current StreamEvent)

The current `StreamEvent` type has:
- `tool_call_start` — provider emits when tool_use block begins
- `tool_call_args` — provider emits incremental argument JSON
- `tool_call_result` — engine emits after scheduler completes execution

There is **no** `tool_execution_start` event. The scheduler runs synchronously between `tool_call_args` completion and `tool_call_result` emission. We do NOT add new engine events in this phase.

#### UI State Mapping

| StreamEvent | UI State | Display |
|---|---|---|
| `tool_call_start` | `pending` | `● toolName` (dim, waiting for args) |
| `tool_call_args` (accumulated, JSON parseable) | `pending` (with params) | `● toolName: paramSummary` (dim) |
| `tool_call_args` (accumulated, NOT parseable) | `pending` | `● toolName: args...` (dim) |
| `tool_call_result` (success) | `success` | `✓ toolName: paramSummary (result summary)` (green) |
| `tool_call_result` (isError) | `error` | `✗ toolName: paramSummary (error message)` (red) |

**No `running` state.** Since there is no engine event for "tool is executing", we cannot display a true running indicator. The gap between the last `tool_call_args` and `tool_call_result` is the execution period, but we have no event to mark its start. Display remains `pending` (dim) until result arrives.

#### Param Summary Detection Rule

There is no "last chunk" marker for `tool_call_args`. The UI must detect argument completeness incrementally:

1. On each `tool_call_args` event, append `args_json` to the tool call's accumulated buffer (keyed by `id`).
2. After each append, attempt `JSON.parse(buffer)`.
3. **If parse succeeds:** Extract param summary (see below). Update the tool line display.
4. **If parse fails:** Keep displaying the previous parseable summary, or `args...` if never parsed. Do NOT display raw partial JSON.
5. On `tool_call_result`: use the last successfully parsed summary. If never parsed, use `args...`.

This ensures the UI never shows malformed JSON, and param display updates as soon as complete JSON is available.

#### Param Summary Extraction

From the parsed JSON object:
- **Bash tool:** Extract `command` field, truncate to 60 chars
- **File read/write/edit:** Extract `path` or `file_path` field
- **Grep/glob:** Extract `pattern` or `query` field
- **Other:** First string-valued field, truncated to 60 chars
- **Fallback:** `args...` if no suitable field found

#### Result Summary

- **Bash:** exit code or first line of stdout
- **File read:** `{n} lines`
- **File write/edit:** `written` / `edited`
- **Grep/glob:** `{n} matches`
- **Web fetch:** HTTP status code
- **Other:** first 40 chars of result

### 4. CommandPalette

#### Trigger

Immediately on typing `/`. Closes when:
- Input no longer starts with `/`
- `Esc` pressed
- Command confirmed

#### Behavior

| Action | Behavior |
|---|---|
| Type `/` | Open palette, show all commands |
| Type more chars | Filter commands in real-time |
| `↑` / `↓` | Navigate selection (wraps around) |
| `Tab` | Insert highlighted command name into input, close palette. User continues typing args. |
| `Enter` | See Enter rules below. |
| `Esc` | Close palette, clear input |

#### Enter Rules

Enter behavior depends on whether the input exactly matches a command name:

| Condition | Enter Behavior |
|---|---|
| Input matches a command exactly (e.g. `/help`) | **Execute** the command directly. Close palette. |
| Input is a prefix of commands (e.g. `/he`) | **Complete** to highlighted command name. Close palette. Do NOT submit. |
| Palette highlight active, input differs from highlight | **Complete** to highlighted command name. Close palette. Do NOT submit. |
| Input has no matching command | **Submit** as-is (will produce "Unknown command" error). |

**Key rule:** Enter only executes when the input is already a valid, complete command name (exact match via `commandRegistry.has(name)`). Otherwise Enter completes, and the user presses Enter again to execute.

**Examples:**
- `/help` → Enter → executes `/help` (exact match, 1 keypress)
- `/he` → palette highlights `/help` → Enter → inserts `/help` → Enter again → executes (2 keypresses)
- `/model` → palette highlights `/model` → Enter → inserts `/model` → user types ` deepseek` → Enter → executes `/model deepseek`
- `/xyz` → no match → Enter → submits → "Unknown command" error

#### Rationale

- **Tab** = always complete (never execute). Safe for commands with args.
- **Enter** = execute if ready, complete if not. Two-step for prefix matches prevents accidental execution of wrong command.
- Exact match detection via `commandRegistry.has(name)` is unambiguous — no guessing about "did the user mean this?"

#### Data Source

`commandRegistry.list()` — returns `Command[]` with `{ name, description, usage?, aliases?, hidden? }`.
Filter out `hidden` commands (already done by `list()`). Render palette rows using `name`, `aliases` (in parentheses), `description`, and `usage` (if present, shown dim after description).

#### Display

```
┌─────────────────────────────────────┐
│ /help   (h, ?)   Show help info     │
│ /clear           Clear conversation │
│ /config          View configuration │
└─────────────────────────────────────┘
```

Max 8 visible items. If more, show `↑ more` / `↓ more` indicators.

### 5. InputLine

- **Position:** Above bottom bar, below palette (when visible)
- **Prompt:** `❯ ` (green) for normal, `❓ ` (yellow) for AskUser
- **Cursor:** Dim block `█`

### 6. BottomBar

- **Position:** Bottom of screen
- **Left:** `↑↓:history  Tab:complete  Ctrl+C:abort`
- **Right:** `tok:{inputTokens}+{outputTokens}` or `tok:~{estimated}` (see Token Statistics)
- **Style:** Dim text, single line

## Event Mapping

### StreamEvent → UI State

```
Provider.chat()                    query()                          REPL UI
─────────────────                  ────────                         ───────
tool_call_start(id, name)    →    yield event                 →    Add OutputLine {type:"tool", state:"pending"}
tool_call_args(id, json)     →    yield event (×N chunks)     →    Accumulate args_json per id, try JSON.parse, update params on success
                                   scheduleToolCalls()
                                   [no event during execution]
tool_call_result(id,result)  →    yield event                 →    Update OutputLine {state:"success/error"}
text_delta(text)             →    yield event (×N chunks)     →    Append to streamBuffer, re-render markdown
thinking_delta(text)         →    yield event                 →    (Phase 1: ignore or dim display)
error(err)                   →    yield event                 →    Add OutputLine {type:"error"}
done(reason)                 →    yield event                 →    Flush streamBuffer to OutputLine
```

### Key Constraint

Between the last `tool_call_args` and `tool_call_result`, there is **no event**. The UI shows `pending` state during this gap. A future phase could add `tool_execution_start` to the engine, but that is out of scope for this design.

## Input Priority

When multiple input modes are active, priority is:

1. **AskUser mode** (highest) — when `pendingAsk` is non-null, all input goes to AskUser answer. No palette, no history.
2. **Command palette** — when palette is visible, `↑`/`↓`/`Tab`/`Enter`/`Esc` go to palette. Regular typing goes to input filter.
3. **History navigation** — when palette is closed and input is empty, `↑`/`↓` navigate history.
4. **Normal input** (lowest) — regular text input.

### Key Transitions

| Current State | Input | Action |
|---|---|---|
| Normal | `/` | Open palette |
| Palette open | `Esc` | Close palette, clear input |
| Palette open | `Tab` | Insert highlighted command, close palette |
| Palette open | `Enter` | Follow CommandPalette Enter Rules (see above) |
| Palette open | `↑`/`↓` | Navigate palette |
| History mode | `↑`/`↓` | Navigate history |
| History mode | Any char | Exit history, start typing |
| AskUser | Any | Answer question |

## Streaming & Markdown Rendering

### Throttling Strategy

**Problem:** Parsing the entire buffer with `marked.lexer()` on every `text_delta` is O(n) per delta. Long responses cause terminal lag.

**Solution:**

1. **Time-based throttle:** Re-parse markdown at most every **80ms**. Accumulate deltas in buffer, only parse when throttle timer fires.
2. **Line-boundary optimization:** When a delta contains `\n`, force a re-parse (code block boundaries are line-delimited).
3. **Degradation threshold:** If buffer exceeds **10,000 chars** and response is still streaming, switch to plain text rendering until `done` event, then do final markdown render.

### Unclosed Block Stability

**Problem:** Streaming markdown may have unclosed code blocks or paragraphs that change layout on every delta.

**Solution:**

1. **Unclosed code blocks:** Render as plain text (no syntax highlighting) until the closing ` ``` ` arrives. Mark with `(streaming...)` dim suffix.
2. **Unclosed paragraphs:** Treat as complete paragraph (render as-is). Markdown is forgiving — an unclosed paragraph still renders correctly.
3. **No re-flow:** Once a line has been rendered and the cursor has moved past it (new content below), do NOT re-render it. Only the last visible block may change during streaming.

### Final Render

On `done` event:
1. Flush `streamBuffer` as a single `OutputLine {type: "assistant"}`
2. Re-parse full content with `marked.lexer()`
3. Apply syntax highlighting to all code blocks
4. Replace the streaming output with final rendered output

## Tool Call Status

### State Machine (aligned with StreamEvent)

```
tool_call_start  →  pending (dim, no params yet)
tool_call_args   →  pending (dim, params visible when accumulated JSON becomes parseable)
tool_call_result →  success (green) or error (red)
```

No `running` state — see Event Mapping section.

### Display Format

```
● bash: ls -la                        ← pending (dim, args streaming in)
✓ bash: ls -la (3 lines)             ← success (green)
✗ bash: rm -rf / (Permission denied)  ← error (red)
```

### Collapse

Full params/result never shown inline. Only summary displayed.

## AskUser Integration

### Current Behavior (preserve)

The current REPL has:
- `pendingAsk` state with multi-question support (`askIndex`, `askAnswers`)
- `❓ ` prompt in AskUser mode
- `(N/M)` question counter
- `Esc` to cancel entire ask
- Answer history echoed to output

### Enhanced Display

In the new OutputArea:
- Pending question: `{type: "system", content: "[AskUser] (1/3) What language?"}` rendered in yellow
- User answer: `{type: "user", content: "TypeScript"}` rendered as normal user input
- All Q&A pairs appear in OutputArea history (scrollable)

### Input Priority

When `pendingAsk` is non-null:
- All keyboard input goes to AskUser answer (highest priority)
- Command palette is **not** triggered by `/`
- History navigation is **disabled**
- `Enter` submits answer
- `Esc` cancels entire ask (current behavior)

### Streaming During AskUser

If a `text_delta` arrives while AskUser is pending (edge case — tool triggered a question mid-stream):
- Streaming buffer continues accumulating in background
- AskUser input remains focused
- Streaming output renders below AskUser prompt (user can see both)

## Ctrl+C / Abort Design

### QueryEngine Signal Plumbing (required change)

Currently `QueryEngine.query()` does NOT accept `signal`. Fix:
1. Add `signal?: AbortSignal` to `QueryEngine.query()` options
2. Forward to inner `query()` call → `provider.chat()` → SDK stream

### REPL Abort Flow

```
Ctrl+C pressed
  ├─ Is streaming/query active?
  │   ├─ Yes → abortController.abort() → stream stops → show "Interrupted"
  │   └─ No → exit app (current behavior)
  └─ Is AskUser pending?
      └─ Yes → cancel ask (current behavior, takes priority over abort)
```

### Implementation

1. Create `AbortController` before each `engine.query()` call
2. Store ref: `abortControllerRef`
3. On `Ctrl+C`:
   - If `streaming === true`: call `abortControllerRef.current.abort()`, set `streaming = false`, addOutput("Interrupted.")
   - If `streaming === false` and no `pendingAsk`: call `exit()`
4. On `done`/`error` event: `abortControllerRef.current = null`

### Transcript/Memory After Abort

- **Transcript:** Write whatever was received so far (partial response) as assistant event
- **Memory:** Skip auto-memory for aborted responses (incomplete data)
- **Session:** Session remains valid, user can continue

### Tool Execution Abort

- If abort happens during `tool_call_result` wait: the tool may still complete on the server side
- We do NOT kill tool subprocesses (out of scope for Phase 1)
- The `tool_call_result` event may still arrive after abort — discard it silently

## Token Statistics

### Data Source

Current state: `CostTracker` exists but is **not wired** into providers or engine.

### Phase 1: Estimate from Response Length

- Count characters in `text_delta` events
- Estimate: `outputTokens ≈ chars / 4` (rough approximation)
- Input tokens: unknown in Phase 1, display as `?`
- Display: `tok:?+~{estimated}`

### Phase 2 (future): Wire CostTracker

- Extract `usage` from provider SDK response (Anthropic/OpenAI both return token counts)
- Add `usage` field to `done` StreamEvent
- Display: `tok:{input}+{out}`
- This is explicitly **out of scope** for this design

## Dependencies

### New npm Packages

| Package | Version | Purpose | Node 22 + Ink 7 Compatible |
|---|---|---|---|
| `marked` | `^15.0.0` | Markdown lexer/parser | Yes (pure JS, no native) |
| `cli-highlight` | `^2.1.11` | Syntax highlighting for code blocks | Yes (pure JS) |
| `figures` | `^6.1.0` | Unicode symbols (✓, ✗, ▶, ●) | Yes (pure JS, ESM) |

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@inkjs/testing-library` | `^3.0.0` | Ink component testing |

### Compatibility Notes

- `marked` v15 is ESM-only — compatible with `"type": "module"` in package.json
- `cli-highlight` v2 supports ESM import
- `figures` v6 is ESM-only
- All three are pure JavaScript, no native bindings, no Node version issues

## Incremental Migration

### Current State

```typescript
// app.tsx current
const [output, setOutput] = useState<string[]>([]);
```

All outputs are plain strings. No type metadata, no tool status, no markdown.

### Migration Steps

#### Step 1: Introduce OutputLine type

```typescript
interface OutputLine {
  type: "user" | "assistant" | "tool" | "command" | "error" | "system";
  content: string;
  timestamp: number;
  toolStatus?: {
    id: string;
    name: string;
    params: string;
    state: "pending" | "success" | "error";
    result?: string;
  };
}
```

#### Step 2: Convert addOutput

Change `addOutput(line: string)` to `addOutput(line: OutputLine)` (or helper `addLine(type, content)`).

#### Step 3: Convert existing call sites

| Current code | New code |
|---|---|
| `addOutput(`> ${query}`)` | `addOutput({type: "user", content: query, timestamp})` |
| `addOutput(responseText)` | `addOutput({type: "assistant", content: responseText, timestamp})` |
| `addOutput(`Error: ${msg}`)` | `addOutput({type: "error", content: msg, timestamp})` |
| `addOutput(result)` (command) | `addOutput({type: "command", content: result, timestamp})` |
| AskUser prompts | `addOutput({type: "system", content: msg, timestamp})` |

#### Step 4: Handle streaming buffer

The `streamBuffer` is a separate state from `output`. When streaming starts, create a "live" assistant line. When delta arrives, update `streamBuffer`. When `done`, flush buffer into the assistant line content.

```
streaming starts  → push OutputLine {type:"assistant", content:""} to output
text_delta        → update streamBuffer, re-render last OutputLine
done              → set OutputLine.content = streamBuffer, clear streamBuffer
```

#### Step 5: Handle tool status

On `tool_call_start`: push new `OutputLine {type:"tool", toolStatus:{state:"pending"}}`
On `tool_call_args`: update the matching tool line's `params`
On `tool_call_result`: update the matching tool line's `state` and `result`

Tool lines are matched by `toolStatus.id` (the tool call ID from StreamEvent).

### Backward Compatibility

During migration, support both `string` and `OutputLine` output:
```typescript
const addOutput = useCallback((line: string | OutputLine) => {
  const normalized = typeof line === "string"
    ? { type: "system" as const, content: line, timestamp: Date.now() }
    : line;
  setOutput((prev) => [...prev, normalized]);
}, []);
```

## Ink Limitations & Workarounds

### Scrolling

Ink does not support native scrolling. The OutputArea must manage visibility manually:

- Track `scrollOffset` state (number of lines from bottom)
- Use `useStdout().rows` to get terminal height
- Calculate visible lines: `output.slice(-maxVisible + scrollOffset)`
- `Page Up` / `Page Down` to scroll, `Ctrl+L` to jump to bottom
- Auto-scroll to bottom on new output (unless user has scrolled up)

### Command Palette Overlay

Ink has no z-index or overlay system. Implement as conditional rendering:

- When `showPalette` is true, render palette `<Box>` between OutputArea and InputLine
- The palette is part of the normal flex layout (not floating)
- This means it pushes content up — acceptable trade-off for simplicity

### Terminal Resize

Use `useStdout().columns` and `useStdout().rows` for responsive layout:
- Re-render on terminal resize (Ink handles this automatically)
- Truncate long lines to terminal width
- Adjust visible output lines based on terminal height

## Non-Goals / Phase Split

### Phase 1 (this design)

- TopBar / BottomBar layout
- OutputArea with OutputLine type system
- ToolStatus with pending/success/error (no running state)
- CommandPalette with Tab/Enter/Esc behavior
- Streaming markdown rendering with throttling
- AskUser integration (preserve existing behavior)
- Ctrl+C abort (requires QueryEngine signal plumbing)
- Token estimate from character count
- Command history (↑/↓ when palette closed)

### Phase 2 (future)

- `tool_execution_start` engine event → true `running` state in ToolStatus
- Wire CostTracker for real token usage
- Thinking/reasoning display (`thinking_delta` event)
- MCP server connection status in TopBar
- Permission mode indicator in TopBar

### Phase 3 (future)

- Theme customization
- Keybinding configuration
- Split pane (code + terminal)
- Inline file previews

## Testing

### Acceptance Checklist

#### TopBar
- [ ] Displays product name, model name, session ID
- [ ] Updates model name after `/model` command
- [ ] Truncates session ID to 8 chars

#### Streaming & Markdown
- [ ] Text appears character-by-character during streaming
- [ ] Markdown formatting renders (bold, italic, code, lists)
- [ ] Code blocks get syntax highlighting
- [ ] Unclosed code blocks render as plain text during streaming
- [ ] Final render on `done` applies full markdown + highlighting
- [ ] Throttle prevents lag on long responses (>10k chars)
- [ ] No layout flicker on re-render

#### ToolStatus
- [ ] `tool_call_start` shows dim pending indicator
- [ ] `tool_call_args` accumulates JSON, updates param display only when JSON.parse succeeds
- [ ] `tool_call_args` shows `args...` when JSON not yet parseable
- [ ] `tool_call_result` success shows green with summary
- [ ] `tool_call_result` error shows red with error message
- [ ] Multiple parallel tool calls display correctly
- [ ] Tool lines persist in output history

#### CommandPalette
- [ ] Typing `/` opens palette with all commands
- [ ] Typing more chars filters palette in real-time
- [ ] `↑`/`↓` navigates selection (wraps around)
- [ ] `Tab` inserts command name, closes palette, does not submit
- [ ] `Enter` on exact match (e.g. `/help`) executes command directly
- [ ] `Enter` on prefix (e.g. `/he`) completes to highlighted command, does not submit
- [ ] `Enter` on no match submits as-is (produces "Unknown command" error)
- [ ] `Esc` closes palette, clears input
- [ ] Aliases shown in parentheses
- [ ] Max 8 items visible, scroll indicators for more

#### History
- [ ] `↑`/`↓` on empty input navigates history
- [ ] History does not interfere with palette
- [ ] History does not interfere with AskUser

#### AskUser
- [ ] Single question displays with `❓` prompt
- [ ] Multi-question displays `(1/3)` counter
- [ ] `Enter` submits answer
- [ ] `Esc` cancels entire ask
- [ ] Q&A pairs appear in output history
- [ ] Palette and history disabled during AskUser

#### Scroll
- [ ] `Page Up`/`Page Down` scrolls output
- [ ] `Ctrl+L` jumps to bottom
- [ ] New output auto-scrolls unless user scrolled up

#### Ctrl+C Abort
- [ ] First `Ctrl+C` during streaming aborts query
- [ ] "Interrupted" message shown after abort
- [ ] Partial response written to transcript
- [ ] Second `Ctrl+C` (idle) exits app
- [ ] `Ctrl+C` during AskUser cancels ask (not abort)

#### BottomBar
- [ ] Shortcut hints displayed
- [ ] Token estimate updated after each response
- [ ] Bar stays at bottom during resize

#### Terminal
- [ ] Layout adapts to terminal width
- [ ] Long lines truncated to width
- [ ] Works in iTerm2, Terminal.app, tmux
- [ ] Graceful degradation: no color → plain text
- [ ] Narrow terminal (<40 cols) → simplified layout

### Test Packages

- `@inkjs/testing-library@^3.0.0` for component unit tests
- `vitest` (existing) for test runner
- Manual testing for terminal-specific behavior
