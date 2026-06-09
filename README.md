# slc-code

CLI coding agent platform — a local-first, extensible AI coding assistant.

## Requirements

- Node.js >= 22
- npm

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

## Test

```bash
# All unit tests
npm test

# End-to-end tests only
npm run test:e2e

# Type checking
npm run typecheck
```

## CLI Usage

```bash
# Interactive REPL
slc

# Single query (non-interactive)
slc --print "explain this codebase"

# Read query from stdin
echo "summarize the project" | slc --stdin

# Disable all persistence (transcript + memory)
slc --bare

# Override permission mode
slc --permission-mode plan
slc --permission-mode default

# Override model
slc --model gpt-4o
slc --model claude-sonnet-4-6

# Set working directory
slc --cwd /path/to/project

# Combine flags
slc --bare --print "quick question" --model gpt-4o
```

## Provider Configuration

Create `~/.slc/settings.json` (user-level) or `<project>/.slc/settings.json` (project-level):

```json
{
  "model": "claude-sonnet-4-6",
  "providers": {
    "anthropic": {
      "apiKeyEnv": "SLC_ANTHROPIC_API_KEY"
    },
    "openai": {
      "apiKeyEnv": "SLC_OPENAI_API_KEY",
      "defaultModel": "gpt-4o"
    },
    "openai-compatible": {
      "apiKeyEnv": "SLC_LOCAL_API_KEY",
      "baseURL": "http://localhost:11434/v1",
      "defaultModel": "local-model"
    }
  },
  "permissions": {
    "allow": ["FileRead", "Glob", "Grep"],
    "deny": ["Bash(rm:*)"]
  },
  "mcpServers": {
    "my-server": {
      "transport": "stdio",
      "command": "node",
      "args": ["server.js"]
    }
  }
}
```

**Provider selection** is automatic based on model name:
- `claude-*` -> Anthropic
- `gpt-*`, `o1-*`, `o3-*` -> OpenAI
- Everything else -> OpenAI-Compatible

**API key resolution** priority:
1. `apiKeyEnv` env var (configured in settings)
2. SDK default env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
3. Plaintext `apiKey` in settings (requires 600 permissions)

## Slash Commands (REPL)

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model <name>` | Switch model |
| `/config` | Show/edit configuration |
| `/clear` | Clear conversation |
| `/compact` | Compact conversation history |
| `/permissions [list\|add\|remove]` | Manage permission rules |
| `/diff` | Show current git diff |
| `/cost` | Show session cost summary |
| `/doctor` | Run system diagnostics |
| `/resume [session-id]` | Resume a previous session |
| `/session` | List available sessions |
| `/rename <title>` | Rename current session |
| `/rewind <uuid>` | Rewind to a specific transcript event |
| `/tasks [list\|filter\|update]` | List and manage tasks |
| `/mcp` | Show MCP server status |
| `/skills` | List available skills |
| `/agents` | List active agents |
| `/theme [name]` | Show/switch theme |
| `/keybindings` | Show keyboard shortcuts |
| `/plan` | Enter plan mode (read-only tools only) |
| `/unplan` | Exit plan mode |

## Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Read-only tools auto-allowed; write/execute tools require confirmation |
| `plan` | All write/execute tools denied; read-only tools allowed |

Permission rules use glob-style patterns:
```json
{
  "permissions": {
    "allow": ["FileRead", "Glob", "Grep", "Bash(echo:*)"],
    "deny": ["Bash(rm:*)", "Bash(git push:*)"],
    "ask": ["FileWrite", "Bash"]
  }
}
```

Priority: deny > ask > allow > mode default.

## Known Limitations

- **Interactive mode** (`slc` without `--print`/`--stdin`) requires a terminal with Ink/React support.
- **MCP stdio transport** spawns a child process per server; SSE/HTTP/WS transports require the server to be running.
- **Auto-memory** extracts patterns from conversations; extraction quality depends on the model.
- **Worktree management** requires a git repository with at least one commit.
- **Unicode sanitization** strips control characters from all user input and tool results.
- **Transcript persistence** writes to `~/.slc/sessions/`; cleanup period defaults to 30 days.
