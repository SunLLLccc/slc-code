# SLC Code — 产品需求文档 (PRD)

> **版本**：v1.2
> **日期**：2026-06-07
> **状态**：已修改，待 Codex 复审
> **参考**：Claude Code 源码分析文档 (`~/sunlc_work/claude-code-analysis`)

---

## 1. 项目概述

### 1.1 项目定位

**slc code** 是一个参考 Claude Code 架构复刻的**本地代码 Agent 平台**，聚焦核心执行内核能力，架构预留扩展空间。

不是"模型 API 加壳 CLI"，而是具备独立 Query 内核、文件化 Memory、主干化权限系统和多模型适配的本地 Agent 平台。

### 1.2 核心目标

- 提供完整可用的 CLI 编码助手，支持多模型（Claude / OpenAI / OpenAI 兼容协议）
- 复刻 Claude Code 的核心机制：Query 主循环、Tool 系统、权限体系、沙箱、Memory、上下文管理
- 架构上预留高级扩展能力，但第一版不实现（详见 1.3）

### 1.3 范围边界说明

**第一版包含**：

| 能力 | 说明 |
|------|------|
| 普通 Subagent / AgentTool | 主 Agent 派遣一个子 Agent 执行独立任务，结果回传。属于核心执行能力，Phase 3 实现 |
| Headless / SDK 模式 | QueryEngine 无 UI 执行，供编程调用 |

**第一版不实现，仅架构预留**：

| 功能 | 说明 |
|------|------|
| Coordinator Mode | 主线程改写为 orchestrator 调度多 worker，后续扩展 |
| Swarm Teammates | 多 Agent 团队协作（inbox/mailbox、共享 task list、多窗格并行），后续扩展 |
| 多 Agent 权限回流 | In-process teammate 权限请求回流到 leader UI，后续扩展 |
| Bridge 远程环境桥接 | 本地控制面 + 远程执行面，后续扩展 |
| Remote 远程 Agent 运行 | CI/CD 集成、云端 Agent，后续扩展 |
| 插件市场与自动更新 | 后续扩展 |
| Telemetry / Analytics | 后续扩展 |
| 语音输入 | 后续扩展 |

---

## 2. 技术栈与发布

| 维度 | 选择 |
|------|------|
| **语言** | TypeScript |
| **运行时** | Node.js（兼容 Bun） |
| **终端 UI** | Ink + React |
| **发布形态** | npm 全局包 |
| **CLI 命令** | `slc` |
| **npm 包名** | `slc-code` |

---

## 3. 整体架构

### 3.1 六层架构

```
┌─────────────────────────────────────────────┐
│  CLI 引导层 (entrypoints/cli.ts)             │
│  轻量入口分流：--version / --help / 默认路径   │
├─────────────────────────────────────────────┤
│  初始化层 (core/init.ts, core/setup.ts)      │
│  配置加载 / 环境检测 / 证书 / 信任建立         │
├─────────────────────────────────────────────┤
│  TUI/REPL 层 (repl/)                         │
│  Ink + React 终端渲染 / AppState / 输入输出    │
├─────────────────────────────────────────────┤
│  执行内核 (engine/)                           │
│  Query 主循环 / 流式接收 / 多模型适配          │
├─────────────────────────────────────────────┤
│  Tool/Permission 层 (tools/, permissions/)   │
│  工具注册与调度 / 权限判定 / 沙箱管理           │
├─────────────────────────────────────────────┤
│  扩展预留层 (skills/, hooks/, mcp/)           │
│  MCP Client / Skills / Hooks / 插件接口       │
└─────────────────────────────────────────────┘
```

所有运行形态（REPL 交互、Headless/SDK、Subagent）共用同一套执行内核，不存在不同运行形态的行为差异。

### 3.2 主链路流转

```
cli.ts → main.tsx → init.ts + setup.ts → launchRepl()
  → REPL.tsx → PromptInput → query() → 模型 API
  → runTools() → 工具执行 → 结果回流 → 下一轮 query 循环
```

### 3.3 非交互模式

除 REPL 交互模式外，支持以下非交互运行方式（共用同一套执行内核）：

| 模式 | 用法 | 说明 |
|------|------|------|
| `--print` / `-p` | `slc -p "解释这个函数"` | 单次问答，输出到 stdout 后退出 |
| stdin/pipe | `echo "hello" \| slc --stdin` | 从管道读取输入 |
| `--model` | `slc --model gpt-4o` | 覆盖默认模型 |
| `--permission-mode` | `slc --permission-mode plan` | 覆盖权限模式 |
| `--cwd` | `slc --cwd /path/to/project` | 指定工作目录 |
| `--bare` | `slc --bare` | 临时禁用所有持久化（transcript + memory），适合敏感场景 |

非交互模式下退出码：0 = 成功，1 = 错误，2 = 权限被拒绝。

---

## 4. 项目目录结构

```
slc-code/
├── package.json
├── tsconfig.json
├── src/
│   ├── entrypoints/           # CLI 引导层
│   │   └── cli.ts
│   ├── core/                  # 初始化层
│   │   ├── init.ts
│   │   └── setup.ts
│   ├── repl/                  # TUI/REPL 层
│   │   ├── repl.tsx
│   │   ├── app.tsx
│   │   ├── components/
│   │   └── hooks/
│   ├── engine/                # 执行内核
│   │   ├── query.ts           # Query 主循环
│   │   ├── engine.ts          # QueryEngine (Headless)
│   │   ├── providers/         # 多模型适配器
│   │   │   ├── base.ts
│   │   │   ├── anthropic.ts
│   │   │   ├── openai.ts
│   │   │   └── openai-compatible.ts
│   │   └── stream.ts
│   ├── tools/                 # Tool 层
│   │   ├── base.ts            # Tool 接口协议
│   │   ├── registry.ts        # 工具注册表
│   │   ├── scheduler.ts       # 并发调度
│   │   ├── builtin/           # 19 个内置工具
│   │   └── mcp/               # MCP 工具适配
│   ├── permissions/           # 权限层
│   │   ├── checker.ts
│   │   ├── modes.ts
│   │   ├── rules.ts
│   │   └── prompts.ts
│   ├── sandbox/               # 沙箱层
│   │   ├── sandbox.ts
│   │   ├── seatbelt.ts        # macOS
│   │   ├── bubblewrap.ts      # Linux
│   │   └── config.ts
│   ├── memory/                # Memory 系统
│   │   ├── auto-memory.ts
│   │   ├── session-memory.ts
│   │   ├── memory-prompt.ts
│   │   └── recall.ts
│   ├── context/               # 上下文管理
│   │   ├── manager.ts
│   │   ├── compact.ts
│   │   └── re-inject.ts
│   ├── prompt/                # Prompt 管理
│   │   ├── system-prompt.ts
│   │   ├── sections.ts
│   │   └── prompts.ts
│   ├── commands/              # 斜杠命令
│   │   ├── registry.ts
│   │   └── builtin/           # 22 个内置命令
│   ├── skills/                # Skills 系统
│   │   ├── discovery.ts
│   │   ├── loader.ts
│   │   └── executor.ts
│   ├── hooks/                 # Hook 系统
│   │   ├── registry.ts
│   │   └── types.ts
│   ├── session/               # 会话持久化
│   │   ├── transcript.ts
│   │   └── resume.ts
│   ├── config/                # 配置管理
│   │   ├── settings.ts
│   │   └── models.ts
│   ├── security/              # 安全基础设施
│   │   ├── unicode.ts
│   │   └── secrets.ts
│   └── utils/
│       ├── logger.ts
│       └── cost-tracker.ts
├── resources/
│   └── prompts/
└── tests/
```

---

## 5. 执行内核

### 5.1 Query 主循环

`query()` 是系统核心，返回 `AsyncGenerator<StreamEvent>`，所有运行形态共用。

**流程**：

1. 组装上下文（system prompt + memory + SLC.md + git status）
2. 调用模型 API（流式），通过 Provider 抽象层适配不同模型
3. 提取模型输出中的 `tool_use` 列表
4. 工具调度执行（`partitionToolCalls()` 分并发/串行）
5. 工具结果追加到 messages
6. 后处理（hooks → compact 检查）
7. 如果仍有 `tool_use` 且未达上限，回到步骤 2

**统一流事件类型**：`TextDelta | ToolCallStart | ToolCallResult | ThinkingDelta | Error | Done`

### 5.2 Provider 抽象

统一多模型调用的核心接口。每个 Provider 负责：
- 将内部统一消息格式转为 API 要求的格式
- 将 API 响应转回统一的流事件
- 声明模型能力（context window、tool use、vision、prompt cache 等）

**三个 Provider 实现**：

| Provider | SDK | 特殊处理 |
|----------|-----|---------|
| AnthropicProvider | `@anthropic-ai/sdk` | prompt cache、extended thinking |
| OpenAIProvider | `openai` | function calling、JSON mode、vision |
| OpenAICompatibleProvider | `openai` + 自定义 baseURL | Ollama/vLLM/LMStudio 等本地模型 |

内部系统统一使用 `ProviderMessage` 格式，Provider 负责双向转换。

### 5.3 Provider 能力矩阵与降级策略

**能力矩阵**：

| 能力 | Anthropic | OpenAI | OpenAI Compatible |
|------|-----------|--------|-------------------|
| Tool Use | ✓ | ✓ | 视具体模型 |
| Streaming | ✓ | ✓ | ✓ |
| Vision | ✓ | ✓ | 视具体模型 |
| Prompt Cache | ✓ | ✗ | ✗ |
| Extended Thinking | ✓ | ✗ | ✗ |
| JSON Mode | ✗ | ✓ | 视具体模型 |

**降级策略**：

| 场景 | 处理方式 |
|------|---------|
| 不支持 Tool Use | 禁用工具声明，回退为纯文本对话模式，告知用户当前模型不支持工具调用 |
| 不支持 Prompt Cache | Section 仍按数组组织（架构一致），但不设置 cache_control 标记，不影响功能 |
| 不支持 Extended Thinking | 跳过 thinking 相关处理，ThinkingDelta 事件不产生 |
| 不支持 Vision | 自动跳过图片附件，文本内容正常处理 |
| 能力未知（OpenAI Compatible） | 启动时尝试一次 probe 请求检测能力；检测失败则按"仅支持 Streaming + 文本"最低配置运行 |

### 5.4 QueryEngine（Headless 模式）

无 UI 的执行引擎，可供 SDK/编程调用。与 REPL 共享同一个 `query()` 主循环，只是不渲染 UI。

---

## 6. Tool 系统

### 6.1 Tool 接口协议

每个工具需声明：能力描述（name/description）、输入输出 Schema、安全属性（并发安全/只读/破坏性）、语义校验、权限检查、UI 渲染。

**Fail-Closed 策略**：所有安全属性默认为最保守值，工具开发者必须显式声明安全属性，遗漏声明 = 安全。

### 6.2 工具调度

- `partitionToolCalls()` 根据工具的 `isConcurrencySafe()` 声明分组
- 并发安全的工具同批并行执行，不安全的串行执行
- 并发批次内的上下文修改延迟到批次结束后统一应用，防止竞态

**执行流程**：Schema 校验 → 语义校验 → PreToolUse Hooks → 权限判定 → 执行 → 结果回流

### 6.3 内置工具清单（19 个）

| 工具 | 只读 | 并发安全 | 说明 | Phase |
|------|------|---------|------|-------|
| BashTool | ✗ | ✗ | Shell 命令执行，沙箱集成 | 2 |
| FileReadTool | ✓ | ✓ | 读取文件/图片/PDF/Notebook | 2 |
| FileEditTool | ✗ | ✗ | 精确字符串替换编辑 | 2 |
| FileWriteTool | ✗ | ✗ | 创建/覆盖文件 | 2 |
| GlobTool | ✓ | ✓ | 文件模式匹配搜索 | 2 |
| GrepTool | ✓ | ✓ | 内容搜索（支持正则） | 2 |
| AgentTool | ✗ | ✗ | 子 Agent 派遣 | 3 |
| TaskCreateTool | ✗ | ✓ | 任务创建 | 3 |
| TaskGetTool | ✓ | ✓ | 任务查询 | 3 |
| TaskListTool | ✓ | ✓ | 任务列表 | 3 |
| TaskUpdateTool | ✗ | ✓ | 任务更新 | 3 |
| WebFetchTool | ✓ | ✓ | URL 内容抓取 | 4 |
| WebSearchTool | ✓ | ✓ | 网络搜索 | 4 |
| NotebookEditTool | ✗ | ✗ | Jupyter Notebook 编辑 | 4 |
| ScheduleCronTool | ✗ | ✓ | 定时任务调度 | 4 |
| SkillTool | ✓ | ✓ | 技能调用 | 4 |
| AskUserTool | ✓ | ✓ | 向用户提问 | 4 |
| EnterPlanModeTool | ✓ | ✓ | 进入计划模式 | 4 |
| ExitPlanModeTool | ✓ | ✓ | 退出计划模式 | 4 |

---

## 7. 权限体系

### 7.1 权限模式

| 模式 | 行为 |
|------|------|
| **default** | 每次工具调用都需用户确认（只读工具除外） |
| **acceptEdits** | 文件编辑类自动通过，其他仍需确认 |
| **plan** | 只允许只读操作，不可修改 |
| **auto** | 根据规则自动判断，危险操作仍需确认 |
| **bypassPermissions** | 跳过用户确认 UI，但工具自身 deny、显式 deny 规则、Hook deny 仍然生效（需显式启用，有安全风险提示） |

### 7.2 权限判定流程与决策优先级

**判定链路**（按优先级从高到低）：

```
工具调用请求
  │
  ├─ 1. 工具自身 checkPermissions() — deny 则直接拒绝，不可覆盖
  │
  ├─ 2. 显式 deny 规则 — 用户配置的 deny 规则优先级最高，不可被其他规则覆盖
  │
  ├─ 3. 显式 ask 规则 — 用户配置的 ask 规则强制弹出确认 UI，不可被 auto-allow 跳过
  │
  ├─ 4. PreToolUse Hooks — Hook 返回 deny 可拦截执行
  │
  ├─ 5. 权限模式限制
  │   ├── plan 模式：只允许 isReadOnly() = true 的工具
  │   ├── default 模式：非只读工具需用户确认
  │   ├── acceptEdits 模式：文件编辑类自动通过，其他需确认
  │   ├── auto 模式：根据 allow 规则自动通过，未匹配的需确认
  │   └── bypassPermissions 模式：跳过用户确认 UI，但仍受步骤 1-4 约束
  │
  ├─ 6. 沙箱 auto-allow — 进沙箱的命令可自动放行，但不能覆盖步骤 1-4 的 deny/ask
  │
  ├─ 7. 显式 allow 规则 — 匹配则自动通过
  │
  └─ 8. 默认行为 — 弹出确认 UI
      → 用户允许 / 拒绝 / 允许并记住（添加持久 allow 规则）
```

**关键原则**：

- **Fail-Closed**：安全属性未声明时默认最保守值（不可并发、非只读、需权限）
- **deny > allow**：显式 deny 规则优先级始终高于 allow
- **沙箱 ≠ 免审**：沙箱 auto-allow 不能覆盖显式 deny/ask 规则
- **MCP 工具也过权限**：MCP 工具调用同样经过 deny 规则过滤
- **权限模式不可跳过 deny**：即使在 bypassPermissions 模式下，工具自身 deny、显式 deny 规则、PreToolUse Hook deny 仍然生效。bypassPermissions 只跳过用户确认 UI，不跳过安全策略

### 7.3 权限规则格式

```
ToolName(参数模式)
```

- `*` 匹配所有，`前缀:*` 匹配前缀开头的参数
- deny 优先级高于 allow
- 用户可通过 `/permissions` 命令或直接编辑 settings.json 管理

---

## 8. 沙箱系统

### 8.1 双平台支持

- **macOS**：Seatbelt（`sandbox-exec`）— 可读写路径白名单 + 网络域名白名单
- **Linux**：Bubblewrap（`bwrap`）— bind/ro-bind 路径控制 + unshare-net
- **Windows**：第一版不实现系统级沙箱，仅依赖应用层权限控制，后续评估 Windows Sandbox / WSL 集成方案

### 8.2 核心安全措施

1. **控制平面保护**：settings 文件和 `.slc/skills/` 目录强制 denyWrite，防止沙箱内命令投毒
2. **Git bare repo 逃逸防护**：沙箱内命令可能在 cwd 植入伪造 bare repo，后续无沙箱 git 命令消费恶意配置导致宿主机代码执行。系统在执行前构造限制 + 执行后清理残留
3. **沙箱 ≠ 免审**：即使进沙箱，仍检查显式 deny/ask 规则
4. **配置热更新**：沙箱配置在 session 内可实时修改
5. **网络规则一致性**：网络白名单从 `WebFetch(domain:...)` 权限规则反推，确保应用层和底层一致

---

## 9. Memory 系统

### 9.1 四层 Memory 体系

| 层级 | 存储位置 | 生命周期 | 用途 |
|------|---------|---------|------|
| **Auto Memory** | `~/.slc/memory/` 或 `.slc/memory/` | 持久 | 用户偏好、项目事实、长期协作知识 |
| **Session Memory** | `~/.slc/sessions/{id}/session-memory.md` | 会话内 | 当前会话摘要，辅助 compact |
| **Agent Memory** | `.slc/agents/{name}/memory/` | 持久 | 特定 Agent 的专属记忆 |
| **Team Memory** | `.slc/teams/{team}/memory/` | 持久 | 团队共享知识（第一版仅预留接口） |

### 9.2 存储模型

每条记忆是一个独立的 Markdown 文件，包含 YAML frontmatter（name / description / metadata.type）和正文。

`MEMORY.md` 是索引文件，限 200 行 / 25KB，硬截断保护。

### 9.3 核心机制

- **召回**：读取 MEMORY.md 索引，根据文件名和描述轻量筛选，最多选 5 个相关文件注入 prompt，已展示过的不再重复召回
- **提取**：后台 subagent 自动检测用户偏好、项目事实，创建/更新记忆文件和索引
- **Session Memory**：会话达 10000 token 后初始化，每增长 5000 token 且满足条件时由后台沙箱化 subagent 更新
- **写入权限边界**：
  - Session Memory 后台 subagent 只允许使用 FileEditTool，且只能操作当前 session 的 `session-memory.md` 文件的精确路径
  - Auto Memory 提取 subagent 只允许使用 FileWriteTool / FileEditTool，且只能写入 `~/.slc/memory/` 或 `.slc/memory/` 目录下的文件
  - Memory 提取 subagent 受完整权限和沙箱约束，不能读写任意路径
  - MEMORY.md 索引更新同样受路径白名单限制
- **注入**：`buildMemoryPrompt()` 同步读取索引，召回相关记忆，拼入 system prompt

---

## 10. 上下文管理

### 10.1 额度分配

从总 Context Window 中预留最高 20k 给 Summary API 使用。模型输出默认 `max_tokens = 8000`（分析表明 99 分位输出约 5000 token），遇到截断自动重试提升到 64k。

### 10.2 Auto-Compact

当剩余 token < 13000 时触发压缩：

1. 剔除图片和大附件
2. 执行 PreCompact Hooks
3. 尝试 Session Memory 补偿（读取已有的 session-memory.md）
4. 调用模型生成摘要（forked subagent 借用 Prompt Cache）
5. 压缩后重建：重新注入当前文件内容、未完成 Plan、MCP 工具列表、工具能力声明

**熔断机制**：连续压缩失败 3 次完全停止 auto-compact，防止无效 API 调用。

**PTL 处理**：Summary API 也超限时，剥洋葱式截掉 20% 旧消息重试。

### 10.3 四种 Compact 策略

| 策略 | 触发方式 | 说明 |
|------|---------|------|
| 手动 compact | `/compact` 命令 | 用户主动触发 |
| 自动 compact | token 接近满 | 系统自动，带熔断保护 |
| Session Memory compact | 有 session memory 时 | 用 session memory 替代旧历史，不额外调用 API |
| Micro compact | 紧急情况 | 仅截掉最旧一部分消息 |

---

## 11. Prompt 管理

### 11.1 核心理念

Prompt 不是字符串，而是 **Section 数组**——每段可独立缓存、插拔、统计 token。

### 11.2 六层 Prompt 拼装

1. **默认主系统提示**：slc code 身份、能力描述、行为规范
2. **运行时上下文注入**：SLC.md / 当前日期 / git status / cache breaker
3. **Memory 注入**：召回的相关记忆文件正文
4. **工具能力声明**：当前可用工具列表及其 schema
5. **MCP/Skills 动态 Section**：已连接 MCP 工具、已激活技能
6. **启动期附加指令**：CLI 参数、管道输入、追加指令

### 11.3 覆盖优先级

Override > Coordinator > Agent/Custom > Default > Append

### 11.4 Prompt 缓存

静态主干（身份描述、行为规范）+ `DYNAMIC_BOUNDARY` 标记 + 动态 Section（文件上下文、git status 等）。缓存在 `/clear`、`/compact`、worktree 切换时失效。

---

## 12. Skills 技能系统

### 12.1 三种来源

| 来源 | 位置 | 说明 |
|------|------|------|
| File-based | `.slc/skills/` 或 `~/.slc/skills/` | 用户自建 Markdown 技能 |
| Bundled | `src/skills/bundled/` | slc code 内建技能 |
| MCP Skills | MCP Server | 工具能力映射 |

### 12.2 技能文件

Markdown + YAML frontmatter（name / description / allowed_tools / model / user_invocable / paths）。支持内嵌 Shell 执行（`!`command`` 语法），MCP 来源的技能不执行内嵌 Shell（安全切断）。

### 12.3 技能发现

启动时并行扫描所有来源，`fs.realpath` 取真实路径去重，memoize 缓存（同一 cwd 只发现一次）。声明了 `paths` 的技能在操作匹配文件时自动激活。

---

## 13. MCP 集成

### 13.1 传输协议

四种：`stdio`（本地进程，最常用）、`sse`（HTTP 长连接）、`ws`（WebSocket，IDE 集成）、`http`（HTTP + 流式）。

### 13.2 核心机制

- 工具命名：`mcp__{serverName}__{toolName}`，内建工具优先级高于同名 MCP 工具
- 连接缓存：同一 server 配置只建一次连接
- 超时控制：使用 `setTimeout`（非 `AbortSignal.timeout`，避免 Bun 内存泄漏）
- 描述长度：MCP 工具描述 > 2048 字符强制截断
- 并发控制：本地连接默认 3 并发，远程默认 20 并发
- 认证雪崩防护：认证失败后 15 分钟内短路返回
- Session 过期检测：HTTP 404 + JSON-RPC -32001 → 自动重连

---

## 14. 会话持久化与恢复

### 14.1 存储模型

Append-only JSONL 事件流，存储在 `~/.slc/sessions/`。只有 `user` / `assistant` / `attachment` / `system` 算 transcript message。Subagent 有独立 sidechain 文件，不混写主 transcript。

### 14.2 持久化开关与隐私

| 数据 | 开关 | 默认 | 说明 |
|------|------|------|------|
| Transcript 持久化 | `session.persistenceEnabled` | `true` | 设为 `false` 时不写入 JSONL 文件 |
| Transcript 清理 | `session.cleanupPeriodDays` | `30` | 设为 `0` 立即清理，不保留任何会话记录 |
| Auto Memory | `memory.autoMemoryEnabled` | `true` | 设为 `false` 不提取和写入记忆文件 |
| Session Memory | 随 Transcript 开关 | 同 Transcript | Transcript 关闭时 Session Memory 也不写入 |
| CLI 一次性禁用 | `--bare` 参数 | — | 临时禁用所有持久化（transcript + memory），适合敏感场景 |

### 14.3 写入规则

- 内存队列 → 批量 flush，文件权限 0600，目录权限 0700
- 主链去重（同 UUID 不重复写），sidechain 保真

### 14.4 大文件优化

Session 列表只读头尾 64KB（lite reader）。完整恢复时先扫描 compact boundary，只读有效部分。

### 14.5 恢复流程

`/resume` 触发完整恢复流水线：加载 transcript → 重建会话图 → 修复 compact/snip → 补回孤立 tool_result → 恢复运行时状态（sessionId、agent identity、worktree、cost tracker 等）→ 重新接管 UI。

---

## 15. 斜杠命令系统

### 15.1 命令注册

每个命令声明 name、description、usage、aliases、hidden 属性和 execute 函数。

### 15.2 内置命令清单（22 个）

| 分类 | 命令 | 说明 | Phase |
|------|------|------|-------|
| 会话管理 | `/clear` | 清空当前对话 | 1 |
| | `/compact` | 手动触发上下文压缩 | 3 |
| | `/resume` | 恢复上次会话 | 3 |
| | `/session` | 查看会话列表 | 3 |
| | `/rename` | 重命名当前会话 | 3 |
| | `/rewind` | 回退到某个历史节点 | 3 |
| 配置 | `/config` | 查看/修改配置 | 1 |
| | `/model` | 切换模型 | 1 |
| | `/theme` | 切换主题 | 4 |
| | `/permissions` | 管理权限规则 | 2 |
| | `/keybindings` | 快捷键配置 | 4 |
| 开发 | `/help` | 帮助信息 | 1 |
| | `/cost` | 查看 API 费用 | 2 |
| | `/doctor` | 环境诊断 | 2 |
| | `/diff` | 查看当前 diff | 2 |
| | `/files` | 查看相关文件 | 2 |
| | `/tasks` | 查看任务列表 | 3 |
| 扩展 | `/mcp` | MCP Server 管理 | 4 |
| | `/skills` | 技能管理 | 4 |
| | `/agents` | Agent 管理 | 4 |
| 计划模式 | `/plan` | 进入计划模式 | 4 |
| | `/unplan` | 退出计划模式 | 4 |

---

## 16. 安全基础设施

### 16.1 Unicode 清洗

所有用户输入和外部内容（MCP 返回、文件内容）进入 prompt 前经过 Unicode 清洗：NFKC 规范化 + Unicode 属性类移除 + 显式字符范围清理，循环最多 10 次。对 MCP 工具调用 input 递归处理 JSON 中所有字符串（含 key）。

### 16.2 密钥扫描

覆盖 AWS、Anthropic、GitHub、OpenAI 等 30+ 种凭据模式。扫描结果只返回规则命中标记而非原文，支持 redact 替换。

### 16.3 Trust 分阶段初始化

初始化分 Trust 前后两阶段：
- **Trust 前**：只应用安全白名单环境变量、初始化证书和 HTTP Agent
- **Trust 后**：才应用完整环境变量、加载用户自定义配置

防止配置文件本身成为攻击面。

> 注：Telemetry/Analytics 第一版不实现，Trust 后阶段仅包含配置加载，为后续扩展预留接口。

---

## 17. 配置体系

### 17.1 目录结构

```
~/.slc/                          # 用户全局目录
├── settings.json                # 全局设置
├── settings.local.json          # 本地覆盖（不纳入版本控制）
├── memory/                      # 用户级记忆
│   └── MEMORY.md
├── sessions/                    # 会话 transcript
├── skills/                      # 用户级技能
├── mcp-needs-auth-cache.json    # MCP 认证缓存
└── keybindings.json             # 快捷键

.slc/                            # 项目级目录
├── settings.json                # 项目设置
├── settings.local.json          # 本地覆盖
├── SLC.md                       # 项目指令文件
├── memory/                      # 项目级记忆
│   └── MEMORY.md
├── skills/                      # 项目级技能
└── rules/                       # 项目规则文件（自动加载）
```

### 17.2 SLC.md 四层信任

优先级从低到高：

1. `/etc/slc/SLC.md` — 系统级（Managed）
2. `~/.slc/SLC.md` — 用户级（User）
3. `./SLC.md` — 项目级（Project）
4. `.slc/rules/*.md` — 本地级（Local）

### 17.3 配置合并

默认值 → `settings.json` → `settings.local.json` → 环境变量覆盖（前缀 `SLC_`）

### 17.4 API Key 管理策略

API Key 加载优先级（从高到低）：

1. **环境变量**：`SLC_ANTHROPIC_API_KEY`、`SLC_OPENAI_API_KEY` 等
2. **系统 Keychain**：macOS Keychain / Linux Secret Service（`apiKeyEnv` 指定 keychain 条目名）
3. **settings.json 明文**：仅作为兜底方案

**安全要求**：

- settings.json 中包含 apiKey 时，文件权限必须为 0600（仅用户可读写）
- `settings.local.json`（含 apiKey）必须加入 `.gitignore`
- 日志输出和 UI 显示中对 apiKey 做 redact 处理（仅显示前 4 位 + `...`）
- `/doctor` 和 `/cost` 等命令输出中不得包含完整 apiKey

### 17.5 设置文件核心字段

```json
{
  "model": "claude-sonnet-4-6",
  "providers": {
    "anthropic": {
      "apiKeyEnv": "SLC_ANTHROPIC_API_KEY",
      "defaultModel": "claude-sonnet-4-6"
    },
    "openai": {
      "apiKeyEnv": "SLC_OPENAI_API_KEY",
      "defaultModel": "gpt-4o",
      "baseURL": "https://api.openai.com/v1"
    },
    "openai-compatible": {
      "apiKeyEnv": "SLC_LOCAL_API_KEY",
      "defaultModel": "local-model",
      "baseURL": "http://localhost:11434/v1"
    }
  },
  "permissions": {
    "allow": ["Bash(npm test:*)", "FileRead(*)"],
    "deny": ["Bash(rm -rf:*)"]
  },
  "sandbox": {
    "enabled": true,
    "filesystem": {
      "allowWrite": ["./"],
      "denyWrite": ["~/.slc/", "./.slc/"]
    }
  },
  "mcpServers": {
    "my-server": { "command": "node", "args": ["server.js"], "transport": "stdio" }
  },
  "memory": { "autoMemoryEnabled": true },
  "session": { "cleanupPeriodDays": 30 },
  "ui": { "theme": "dark", "outputStyle": "auto" }
}
```

> **关于 `apiKeyEnv` 和 `apiKey`**：
> - `apiKeyEnv`：指定存储 API Key 的环境变量名或系统 Keychain 条目名，**推荐使用**
> - `apiKey`：明文 API Key，**仅作为兜底方案**，使用时 settings 文件权限必须为 0600
> - 两者同时存在时，`apiKeyEnv` 优先；都未配置时，尝试加载 Provider SDK 默认的环境变量（如 `ANTHROPIC_API_KEY`）

---

## 18. 分阶段交付计划

### Phase 1：骨架 + 首条链路跑通

**目标**：`slc` 启动 → 输入问题 → 调用模型 → 获得回答

| 模块 | 内容 |
|------|------|
| CLI 引导层 | `cli.ts` 入口分流、`--version`、`--help`、`--print`、`--stdin`、`--model`、`--permission-mode`、`--cwd`、`--bare` |
| 初始化层 | `init.ts` + `setup.ts` 基础配置加载 |
| TUI/REPL | Ink + React 最小 REPL（输入框 + 文本输出） |
| 非交互模式 | `--print` 单次问答、stdin/pipe 输入、CLI 参数透传 |
| 执行内核 | `query.ts` 主循环 + Provider 抽象接口 |
| Provider | AnthropicProvider 单模型跑通 |
| 基础命令 | `/help`、`/clear`、`/model`、`/config` |

**验收**：
- `slc` → 输入"你好" → 获得模型回复，退出码 0 ✓
- `slc --version` 输出版本号，退出码 0 ✓
- `slc --print "1+1"` 非交互模式输出结果，退出码 0 ✓
- `echo "hello" | slc --stdin` 管道输入正常工作 ✓
- `slc --model gpt-4o` 指定模型启动 ✓
- `slc --bare` 启动后不写入 transcript 和 memory 文件 ✓

### Phase 2：工具体系 + 权限 + 沙箱

**目标**：slc code 能实际操作文件和执行命令

| 模块 | 内容 |
|------|------|
| Tool 协议 | `base.ts` 接口 + `registry.ts` + `scheduler.ts` |
| 权限系统 | 五种权限模式、规则解析、确认 UI |
| 沙箱系统 | macOS Seatbelt + Linux Bubblewrap（Windows 仅权限控制） |
| 内置工具 | BashTool、FileReadTool、FileEditTool、FileWriteTool、GlobTool、GrepTool |
| 更多 Provider | OpenAIProvider + OpenAICompatibleProvider |
| 更多命令 | `/permissions`、`/diff`、`/cost`、`/doctor` |

**验收**：
- `slc` → "帮我创建一个 hello.py 并运行" → 创建文件 + 执行 + 返回结果 ✓
- BashTool 首次执行弹出权限确认 UI，用户允许后执行 ✓
- 用户选择"允许并记住"后，同类命令不再弹出确认 ✓
- 显式 deny 规则生效：配置 `deny: ["Bash(rm:*)"]` 后 rm 命令被拒绝 ✓
- macOS/Linux 沙箱 denyWrite 生效：沙箱内无法写入 `~/.slc/` ✓
- OpenAI 和 OpenAI Compatible Provider 切换正常 ✓

### Phase 3：Memory + 上下文管理

**目标**：长会话可持续运行，具备记忆能力

| 模块 | 内容 |
|------|------|
| Auto Memory | 记忆文件读写、MEMORY.md 索引、召回机制 |
| Session Memory | 后台 subagent 提取与更新 |
| 上下文管理 | 额度分配、Auto-Compact（四种策略） |
| Prompt 管理 | Section 数组、缓存工程、覆盖优先级 |
| 会话持久化 | JSONL transcript 写入与 `/resume` 恢复 |
| AgentTool | 子 Agent 派遣 |
| 任务工具 | TaskCreate/Get/List/Update |
| 更多命令 | `/resume`、`/session`、`/rename`、`/rewind`、`/tasks`、`/compact` |

**验收**：
- 连续对话 30+ 轮后 Auto Memory 自动提取，`~/.slc/memory/` 下出现记忆文件 ✓
- MEMORY.md 索引自动更新，包含新记忆的一行描述 ✓
- 会话达 10000 token 后 session-memory.md 自动创建 ✓
- Auto-Compact 触发后，当前正在查看的文件内容仍可被引用 ✓
- `/resume` 恢复上次会话，历史消息正确加载 ✓
- Transcript JSONL 格式正确，包含 user/assistant/system 事件 ✓
- AgentTool 派遣子 Agent 执行任务，结果回传主 Agent ✓

### Phase 4：Skills + MCP + 完善

**目标**：可扩展的能力平台

| 模块 | 内容 |
|------|------|
| Skills 系统 | 技能发现、加载、内嵌 Shell 执行 |
| MCP 集成 | 四种传输协议、认证雪崩防护、工具池整合 |
| Hook 系统 | PreToolUse / PostToolUse / SessionStart 等 |
| 安全清洗 | Unicode 清洗、密钥扫描 |
| 剩余工具 | WebFetch、WebSearch、NotebookEdit、ScheduleCron、SkillTool、AskUser |
| 剩余命令 | `/mcp`、`/skills`、`/agents`、`/theme`、`/keybindings` |
| 计划模式 | EnterPlanMode / ExitPlanMode |
| Worktree | EnterWorktree / ExitWorktree |

**验收**：
- 配置 MCP Server 后工具列表中出现 `mcp__{name}__{tool}` 工具 ✓
- `.slc/skills/` 下创建 SKILL.md 后通过 `/skill-name` 调用成功 ✓
- Hook 系统在 PreToolUse 阶段正确拦截或放行 ✓
- Unicode 清洗正确过滤隐写字符 ✓
- 完整开发工作流：读取代码 → 编辑 → 运行测试 → 提交 ✓
