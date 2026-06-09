# RC Handoff — slc-code P14

## Verification Commands

### Typecheck

```
$ npx tsc --noEmit
(exit 0, no errors)
```

### Build

```
$ npm run build
(exit 0)
```

### Full Test Suite

```
$ npm test
Test Files  50 passed (50)
Tests       880 passed (880)
Duration    ~5s
```

### E2E Tests

```
$ npm run test:e2e
Test Files  5 passed (5)
Tests       60 passed (60)
Duration    ~4s
```

---

## PRD Acceptance Matrix

### PRD Phase 1 — CLI Entry Point

| Acceptance Item | Entry Point | Test File | Test Name | Type |
|----------------|-------------|-----------|-----------|------|
| `slc --version` available | CLI | `tests/e2e/phase1.test.ts` | `--version prints version string and exits 0` | e2e (mock) |
| `slc --print` available | CLI | `tests/e2e/phase1.test.ts` | `returns mock text and exit code 0 via injected executePrintFn` | e2e (mock provider) |
| `--stdin` available | CLI | `tests/e2e/phase1.test.ts` | `calls injected executeStdinFn and returns success` | e2e (mock provider) |
| `--model` / `--permission-mode` / `--cwd` / `--bare` parsed | CLI | `tests/e2e/phase1.test.ts` | flag accepted + flows through | e2e |
| Basic REPL renders response | REPL | `tests/cli/cli.test.ts` | (createProgram + launchRepl injection) | integration |
| Provider selection heuristics | Config | `tests/config/settings.test.ts` | (model name → provider) | unit |
| API key resolution | Config | `tests/config/settings.test.ts` | (env → sdk default → plaintext) | unit |

### PRD Phase 2 — Provider + Tools + Permissions

| Acceptance Item | Entry Point | Test File | Test Name | Type |
|----------------|-------------|-----------|-----------|------|
| Anthropic/OpenAI/OpenAI-Compatible providers | Engine | `tests/engine/providers.test.ts` | (26 tests: stream, tool use, capabilities) | unit |
| FileRead/FileWrite/FileEdit tools | Tools | `tests/e2e/tools.test.ts` | `FileWrite -> FileRead -> FileEdit -> FileRead cycle` | e2e |
| Glob tool | Tools | `tests/e2e/tools.test.ts` | `finds files matching pattern` | e2e |
| Grep tool | Tools | `tests/e2e/tools.test.ts` | `finds content in files` | e2e |
| Bash tool execution | Tools | `tests/e2e/tools.test.ts` | `executes a command` | e2e |
| 21 builtin tools registered | Tools | `tests/e2e/tools.test.ts` | `registers all 21 builtin tools` | e2e |
| Permission deny rule blocks execution | Scheduler | `tests/e2e/tools.test.ts` | `Bash deny rule blocks execution and execute is not called` | e2e |
| Permission ask blocks without UI | Scheduler | `tests/e2e/tools.test.ts` | `ask rule blocks execution in non-interactive mode` | e2e |
| Permission allow rule permits | Scheduler | `tests/e2e/tools.test.ts` | `explicit allow rule permits execution` | e2e |
| Deny overrides allow | Scheduler | `tests/e2e/tools.test.ts` | `deny rule overrides allow rule` | e2e |
| Plan mode denies writes | Checker | `tests/e2e/tools.test.ts` | `FileWrite is denied in plan mode` | e2e |
| Sandbox config generation | Sandbox | `tests/sandbox/config.test.ts` | (filesystem allow/deny) | unit |
| Git bare repo cleanup | Sandbox | `tests/sandbox/git-cleanup.test.ts` | (8 tests) | unit |
| /permissions /diff /cost /doctor commands | Commands | `tests/commands/phase2-permissions-diff-cost.test.ts` | (21 tests) | integration |

### PRD Phase 3 — Session + Memory + Context

| Acceptance Item | Entry Point | Test File | Test Name | Type |
|----------------|-------------|-----------|-----------|------|
| TranscriptWriter write/read | Session | `tests/e2e/session-memory-compact.test.ts` | `writes and reads back events` | e2e |
| TranscriptWriter dedup | Session | `tests/e2e/session-memory-compact.test.ts` | `deduplicates by uuid` | e2e |
| Disabled writer no-op (--bare) | Session | `tests/e2e/session-memory-compact.test.ts` | `disabled writer does not write` | e2e |
| Session event flow | Session | `tests/e2e/session-memory-compact.test.ts` | `writes user/assistant events and reads back` | e2e |
| SessionManager lifecycle | Session | `tests/repl/session-manager.test.ts` | (15 tests: init, append, switch, bare) | integration |
| /resume /session /rename /rewind | Commands | `tests/commands/session-commands.test.ts` | (19 tests) | integration |
| compactMessages preserves last 10 | Context | `tests/e2e/session-memory-compact.test.ts` | `preserves last 10 non-system messages` | e2e |
| Memory loadMemories with frontmatter | Memory | `tests/e2e/session-memory-compact.test.ts` | `loadMemories reads .md files with frontmatter` | e2e |
| Auto-memory extraction | Memory | `tests/memory/auto-memory-lifecycle.test.ts` | (7 tests: threshold, disabled, patterns) | integration |
| Session-memory lifecycle | Memory | `tests/memory/session-memory-lifecycle.test.ts` | (5 tests: threshold, write) | integration |
| AgentTool with sidechain | Agent | `tests/tools/agent.test.ts` | (16 tests: execute, sidechain, permission inheritance) | integration |
| Task CRUD tools | Tasks | `tests/tools/tasks.test.ts` | (28 tests: create/get/list/update) | integration |
| /tasks command | Commands | `tests/commands/tasks-command.test.ts` | (13 tests: list/filter/update) | integration |
| /compact command | Commands | `tests/commands/basic.test.ts` | (compact dispatch) | integration |

### PRD Phase 4 — MCP + Skills + Phase 4 Tools

| Acceptance Item | Entry Point | Test File | Test Name | Type |
|----------------|-------------|-----------|-----------|------|
| MCP tool naming mcp__server__tool | MCP | `tests/e2e/mcp-skills.test.ts` | `normalizes to mcp__server__tool format` | e2e |
| MCP registry integration via loadMcpToolsIntoRegistry | MCP | `tests/e2e/mcp-skills.test.ts` | `config → connect → listTools → adapt → register` | e2e |
| Builtin priority over MCP | MCP | `tests/e2e/mcp-skills.test.ts` | `builtin tools take priority over MCP tools with same name` | e2e |
| MCP tool execution via QueryEngine | MCP | `tests/e2e/mcp-skills.test.ts` | `provider emits MCP tool call → scheduler executes → tool_result` | e2e |
| MCP auth cache lifecycle | MCP | `tests/e2e/mcp-skills.test.ts` | `set/get/markFailed/isBlocked cycle` | e2e |
| Skill discovery | Skills | `tests/e2e/mcp-skills.test.ts` | `finds project skills in .slc/skills/` | e2e |
| Skill execution (trusted/untrusted) | Skills | `tests/e2e/mcp-skills.test.ts` | shell interpolation tests | e2e |
| WebFetch/WebSearch tools | Tools | `tests/tools/phase4-tools.test.ts` | (mock fetch + provider tests) | integration |
| NotebookEdit/Schedule/Skill/AskUser tools | Tools | `tests/tools/phase4-tools.test.ts` | (56 tests) | integration |
| PlanMode runtime permission chain | Runtime | `tests/engine/runtime-integration.test.ts` | `plan mode: scheduleToolCalls denies/allows` | integration |
| Worktree QueryEngine metadata | Runtime | `tests/e2e/worktree.test.ts` | `toolContext.cwd changes/restores + metadata isolation` | e2e |
| /mcp /skills /agents /theme /keybindings /plan /unplan | Commands | `tests/commands/phase4-commands.test.ts` | (38 tests) | integration |
| AskUser real pending + submit/cancel | REPL | `tests/repl/ask-user-integration.test.ts` | (5 tests: submit, cancel, non-interactive, multi-question) | integration |
| Unicode sanitization | Security | `tests/security/unicode.test.ts` | (21 tests: hidden chars, JSON keys, tool results) | unit |
| Secret redaction | Security | `tests/security/secrets.test.ts` | (9 tests: OpenAI/Anthropic/GitHub/AWS) | unit |

### P14 RC Gate

| Acceptance Item | Entry Point | Test File | Test Name | Type |
|----------------|-------------|-----------|-----------|------|
| README complete | Docs | README.md | (install/build/test/CLI/commands/limitations) | docs |
| E2E script available | Package | package.json | `"test:e2e": "vitest run tests/e2e"` | config |
| --bare no transcript/memory | CLI | `tests/e2e/session-memory-compact.test.ts` | `SessionManager enabled=false creates no dir` | e2e |
| --bare non-bare control group | CLI | `tests/e2e/session-memory-compact.test.ts` | `non-bare DOES write transcript.jsonl` | e2e |
| Phase 1 CLI with mock provider (no auth errors) | CLI | `tests/e2e/phase1.test.ts` | all 11 tests use mock deps | e2e |
| Full test suite green | CI | npm test | 880/880 passed | verification |
| Full build green | CI | npm run build | exit 0 | verification |

---

## Non-Blocking Residual Risks

1. **Real provider auth**: E2E tests use mock providers. Real Anthropic/OpenAI API key testing requires manual verification or CI secrets.
2. **MCP stdio transport**: E2E mocks the MCP SDK Client. A real MCP server integration test would require a test fixture server binary.
3. **Interactive REPL**: The Ink-based REPL (`slc` without `--print`) is not covered by e2e tests; it requires a terminal environment.
4. **Auto-memory extraction quality**: Pattern-based extraction is a heuristic; quality depends on conversation content.
5. **Worktree edge cases**: Complex git worktree states (submodules, bare repos) are not tested.
6. **Secret scanner coverage**: Only high-value patterns (OpenAI/Anthropic/GitHub/AWS) are covered; 30+ additional patterns from PRD are deferred.
7. **Session scoping for tasks**: Task store is module-level global, not session-scoped. Documented as intentional P10 simplification.
