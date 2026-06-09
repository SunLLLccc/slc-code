# REPL UI Enhancement Design

**Date:** 2026-06-09
**Status:** Approved
**Scope:** Claude Code-like terminal UI with status bars, streaming markdown, tool status, slash command autocomplete

## Overview

Enhance the minimal Ink REPL to provide a rich terminal UI experience similar to Claude Code, with status bars, real-time markdown rendering, tool call status display, and slash command autocomplete.

## Layout

```
┌─────────────────────────────────────────────┐
│  slc-code │ deepseek-v4-pro │ session: abc123 │  ← Top status bar
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
│  ❯ 输入中的内容█                             │  ← Input line
├─────────────────────────────────────────────┤
│  ↑↓:历史  Tab:补全  Ctrl+C:中断  tokens: 1.2k│  ← Bottom status bar
└─────────────────────────────────────────────┘
```

## Components

### 1. TopBar (Status Bar)

- **Position:** Top of screen
- **Content:** Product name (`slc-code`), model name, session ID (short hash)
- **Style:** Dim/inverted background, single line, separator `│` between items
- **Dynamic:** Updates when model changes (`/model` command)

### 2. OutputArea

- **Position:** Middle of screen, scrollable
- **Content:** All output lines — user input echo, LLM responses, tool status, command results
- **Rendering:** Each line rendered based on type:
  - User input: `> ` prefix, dim color
  - LLM text: Markdown parsed and rendered with syntax highlighting
  - Tool status: Inline status indicators (see ToolStatus)
  - Command output: Plain text
  - Errors: Red color

### 3. ToolStatus

- **States:** `pending → running → success/error`
- **Display:**
  - Running: `▶ toolName: paramSummary` (yellow)
  - Success: `✓ toolName: paramSummary (result summary)` (green)
  - Error: `✗ toolName: paramSummary (error message)` (red)
- **Param summary:** First line of params, truncated to 60 chars
- **Result summary:** Line count for text output, byte count for binary, error message for failures
- **Collapse:** Full params/result not shown by default

### 4. CommandPalette (Slash Command Autocomplete)

- **Trigger:** Immediately on typing `/`
- **Filter:** Real-time filtering as user types more characters
- **Navigation:** `↑` `↓` to select, `Enter` to confirm, `Esc` to cancel
- **Data source:** `CommandRegistry` — name, aliases, description
- **Display:**
  ```
  ┌─────────────────────────────────┐
  │ /help   (h, ?)  显示帮助信息     │
  │ /clear          清除会话         │
  │ /config         查看配置         │
  └─────────────────────────────────┘
  ```
- **Max items:** Show up to 8 commands, scrollable if more
- **Integration:** Selected command inserted into input, palette closes

### 5. InputLine

- **Position:** Above bottom bar
- **Prompt:** `❯ ` (green) for normal mode, `❓ ` (yellow) for AskUser mode
- **Cursor:** Dim block `█`
- **History:** `↑` `↓` to navigate command history (when palette is closed)

### 6. BottomBar

- **Position:** Bottom of screen
- **Content:** Shortcut hints (left-aligned) + token statistics (right-aligned)
- **Shortcuts:** `↑↓:历史  Tab:补全  Ctrl+C:中断`
- **Tokens:** `tokens: {used}` updated after each response
- **Style:** Dim text, single line

## Streaming & Markdown Rendering

### Strategy

Real-time chunk-by-chunk rendering with markdown parsing.

### Flow

1. Receive `text_delta` events from QueryEngine
2. Append to `streamBuffer` state
3. After each delta, parse buffer with `marked.lexer()` into tokens
4. Render tokens:
   - Paragraphs: plain `<Text>`
   - Code blocks: `highlight()` from `cli-highlight` for syntax coloring
   - Inline code: `<Text bold>` with background
   - Bold/italic: `<Text bold>` / `<Text italic>`
   - Lists: Indented with bullet markers
   - Links: Underlined with URL hint
5. Unclosed code blocks: Render as plain text without highlighting, mark as "streaming"

### Dependencies

- `marked` — Markdown lexer/parser
- `cli-highlight` — Syntax highlighting for code blocks
- `figures` — Unicode symbols (✓, ✗, ▶, ●, etc.)

## Tool Call Status

### State Machine

```
pending → running → success
                  → error
```

### Display Format

```
▶ bash: ls -la                    ← running (yellow)
✓ bash: ls -la (3 lines)         ← success (green)
✗ bash: rm -rf / (Permission denied)  ← error (red)
```

### Summary Logic

- **Bash:** Show command string, result = exit code or line count
- **File read:** Show file path, result = line count
- **File write/edit:** Show file path, result = "written" or "edited"
- **Grep/glob:** Show pattern, result = match count
- **Web fetch:** Show URL, result = status code

## Slash Commands

### Enhanced Command Registry

Add to each command registration:
- `description`: Human-readable description
- `aliases`: Array of alias names (already exists)

### Input Handling

When input starts with `/`:
1. Show CommandPalette overlay
2. Filter commands by typed text after `/`
3. `↑` `↓` to navigate selection
4. `Enter` to confirm — insert full command into input, close palette
5. `Esc` to cancel — close palette, keep input
6. Continue typing to filter — palette updates in real-time

When input does not start with `/`:
1. `↑` `↓` navigate command history
2. Normal text input

## Architecture

### File Structure

```
src/repl/
  app.tsx              — ReplApp (orchestrator)
  components/
    TopBar.tsx          — Status bar (model, session)
    BottomBar.tsx       — Shortcut hints + token stats
    OutputArea.tsx      — Scrollable output rendering
    ToolStatus.tsx      — Tool call status indicators
    CommandPalette.tsx  — Slash command autocomplete overlay
    InputLine.tsx       — Input prompt + cursor
    MarkdownBlock.tsx   — Markdown rendering with syntax highlight
  hooks/
    useHistory.ts       — Command history navigation
    useCommandFilter.ts — Command palette filtering
```

### State Management

All state remains in `ReplApp` (lifted state pattern). Components receive props.

Key state:
- `output: OutputLine[]` — All output lines with type metadata
- `streamBuffer: string` — Current streaming text buffer
- `toolCalls: ToolCallStatus[]` — Active tool call statuses
- `commandHistory: string[]` — Previous commands for ↑↓ navigation
- `historyIndex: number` — Current position in history
- `showPalette: boolean` — Whether command palette is visible
- `paletteFilter: string` — Current filter text for palette
- `paletteIndex: number` — Selected item in palette

### OutputLine Type

```typescript
interface OutputLine {
  type: "user" | "assistant" | "tool" | "command" | "error" | "system";
  content: string;
  timestamp: number;
  toolStatus?: {
    name: string;
    params: string;
    state: "pending" | "running" | "success" | "error";
    result?: string;
  };
}
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
- Alternative: Use absolute positioning if Ink supports it in the version we use

### Terminal Resize

Use `useStdout().columns` and `useStdout().rows` for responsive layout:
- Re-render on terminal resize (Ink handles this automatically)
- Truncate long lines to terminal width
- Adjust visible output lines based on terminal height

## Testing

- Unit tests for each component (Ink testing library)
- Integration test for full REPL flow (input → streaming → output)
- Manual testing for terminal compatibility (iTerm2, Terminal.app, tmux)
