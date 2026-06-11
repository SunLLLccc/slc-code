// Minimal Ink REPL — input box and streaming text output

import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { QueryEngine } from "../engine/engine.js";
import type { Provider } from "../engine/providers/base.js";
import type { StreamEvent } from "../engine/types.js";
import type { CommandRegistry, CommandContext, Command } from "../commands/registry.js";
import { SessionManager } from "./session-manager.js";
import { createResumeSession, createRewindToEvent } from "./session-runtime.js";
import { assembleSystemPrompt } from "../prompt/assembly.js";
import { persistSessionMemory } from "../memory/session-memory-lifecycle.js";
import { processAutoMemory } from "../memory/auto-memory-lifecycle.js";
import { createBuiltinRegistry } from "../tools/builtin/registry-factory.js";
import { setAgentContext } from "../tools/builtin/agent.js";
import { loadTranscript, rebuildSessionState } from "../session/resume.js";
import { createPermissionChecker } from "../permissions/checker.js";
import { getRuntimePermissionMode } from "../tools/builtin/plan-mode.js";
import { parseRule, type PermissionRule } from "../permissions/rules.js";
import {
  createAskUserCallback,
  getPendingQuestions,
  submitAskUserAnswers,
  cancelAskUser,
  type PendingQuestion,
} from "./ask-user-runtime.js";
import { getPermissionRules } from "../commands/builtin/permissions.js";
import { loadMcpToolsIntoRegistry, disconnectAll } from "../tools/mcp/loader.js";
import type { McpServerConfig } from "../tools/mcp/client.js";
import type { McpServerSetting } from "../config/settings.js";
import { getSharedAuthCache } from "../tools/mcp/auth-cache.js";

// New component and type imports
import type {
  OutputLine,
} from "./output-types.js";
import {
  createUserLine,
  createAssistantLine,
  createToolLine,
  updateToolStatus,
  updateToolParams,
  createErrorLine,
  createCommandLine,
  createSystemLine,
} from "./output-types.js";
import { TopBar } from "./components/TopBar.js";
import { BottomBar } from "./components/BottomBar.js";
import { InputLine } from "./components/InputLine.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { ToolStatusLine } from "./components/ToolStatus.js";
import { MarkdownBlock } from "./components/MarkdownBlock.js";
import { StartupPanel } from "./components/StartupPanel.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ReplAppProps {
  provider: Provider;
  commandRegistry: CommandRegistry;
  commandContext: CommandContext;
  initialModel?: string;
  version?: string;
  /** Session directory to resume on startup (from --resume) */
  resumeDir?: string;
}

// ---------------------------------------------------------------------------
// ReplApp
// ---------------------------------------------------------------------------

// Streaming throttle constants (module-level to avoid re-creation on render)
const THROTTLE_MS = 80;
const DEGRADATION_THRESHOLD = 10000;

export function ReplApp({
  provider,
  commandRegistry,
  commandContext,
  initialModel,
  version,
  resumeDir,
}: ReplAppProps) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [currentModel, setCurrentModel] = useState(initialModel ?? "");
  // Track pending AskUser questions for UI and input routing
  // Supports multi-question: tracks current index and collected answers
  const [pendingAsk, setPendingAsk] = useState<PendingQuestion | null>(null);
  const [askIndex, setAskIndex] = useState(0);
  const [askAnswers, setAskAnswers] = useState<string[]>([]);

  // Command history
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Command palette
  const [showPalette, setShowPalette] = useState(false);
  const [paletteFilter, setPaletteFilter] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);

  // Token estimation
  const [estimatedOutputTokens, setEstimatedOutputTokens] = useState(0);

  // AbortController ref for cancelling in-flight queries
  const abortControllerRef = useRef<AbortController | null>(null);

  // Streaming throttle
  const prevBufferRef = useRef<string>("");
  const lastRenderRef = useRef(0);
  const degradedRef = useRef(false);

  // Session manager — tracks current session, writes transcript
  const sessionConfig = commandContext.config?.session as { persistenceEnabled?: boolean; cleanupPeriodDays?: number } | undefined;
  const sessionsBase = (commandContext.config?.sessionsBase as string) ?? undefined;
  const persistenceEnabled = sessionConfig?.persistenceEnabled ?? true;
  const cleanupPeriodDays = sessionConfig?.cleanupPeriodDays ?? 30;
  const userConfigDir = join(homedir(), ".slc");
  const sessionManagerRef = useRef<SessionManager>(
    new SessionManager({ sessionsBase, enabled: persistenceEnabled }),
  );

  // QueryEngine — initialized async with prompt assembly
  const engineRef = useRef<QueryEngine>(new QueryEngine(provider));
  const engineInitRef = useRef<Promise<void> | null>(null);
  // Store toolRegistry and permissionChecker refs for resume/rewind callbacks
  const toolRegistryRef = useRef<ReturnType<typeof createBuiltinRegistry> | null>(null);
  const permissionCheckerRef = useRef<ReturnType<typeof createPermissionChecker> | null>(null);

  // Poll for pending AskUser questions
  useEffect(() => {
    const interval = setInterval(() => {
      const pending = getPendingQuestions();
      if (pending.length > 0 && !pendingAsk) {
        // New question arrived
        setPendingAsk(pending[0]!);
        setAskIndex(0);
        setAskAnswers([]);
      } else if (pending.length === 0 && pendingAsk) {
        // Question resolved externally
        setPendingAsk(null);
        setAskIndex(0);
        setAskAnswers([]);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [pendingAsk]);

  // Initialize session + build system prompt + create QueryEngine
  useEffect(() => {
    const sm = sessionManagerRef.current;
    const cwd = (commandContext.config?.cwd as string) ?? process.cwd();

    // Initialize tools and permissions FIRST (always available, even if prompt fails)
    const toolRegistry = createBuiltinRegistry();
    const askUserCallback = createAskUserCallback();
    const toolContext = { cwd, askUser: askUserCallback, permissionMode: (commandContext.config?.permissionMode as string) ?? "default" };
    // Load MCP tools from config with shared auth cache
    const mcpServersConfig = commandContext.config?.mcpServers as Record<string, McpServerSetting> | undefined;
    const mcpAuthCache = getSharedAuthCache();
    const mcpLoadPromise = mcpServersConfig
      ? loadMcpToolsIntoRegistry(
          Object.entries(mcpServersConfig).map(
            ([name, setting]) => ({ name, ...setting } as McpServerConfig),
          ),
          toolRegistry,
          { authCache: mcpAuthCache },
        ).catch(() => ({ connected: [], failed: [] }))
      : Promise.resolve({ connected: [] as string[], failed: [] as string[] });
    const permissionsConfig = commandContext.config?.permissions as { allow?: string[]; deny?: string[]; ask?: string[] } | undefined;
    const configRules: PermissionRule[] = [
      ...(permissionsConfig?.deny ?? []).map((r) => parseRule(r, "deny")),
      ...(permissionsConfig?.ask ?? []).map((r) => parseRule(r, "ask")),
      ...(permissionsConfig?.allow ?? []).map((r) => parseRule(r, "allow")),
    ];
    const permissionChecker = createPermissionChecker({
      mode: (commandContext.config?.permissionMode as string as any) ?? "default",
      rules: configRules,
      projectRoot: cwd,
      getRuntimeRules: () => getPermissionRules(),
      getRuntimeMode: () => getRuntimePermissionMode() as any,
    });
    toolRegistryRef.current = toolRegistry;
    permissionCheckerRef.current = permissionChecker;

    // Then build system prompt + load MCP tools (may fail — fallback only degrades prompt, not tools)
    engineInitRef.current = Promise.all([
      sm.cleanupAndInit(cleanupPeriodDays),
      mcpLoadPromise,
    ]).then(async () => {
      let systemPrompt: string | undefined;
      try {
        systemPrompt = await assembleSystemPrompt({ cwd, userConfigDir });
      } catch {
        // Prompt assembly failed — continue without system prompt
      }
      engineRef.current = new QueryEngine(provider, {
        ...(systemPrompt ? { systemPrompt } : undefined),
        tools: toolRegistry.toProviderTools(),
        toolRegistry,
        toolContext,
        permissionChecker,
      });
      // --resume: load transcript from previous session into engine
      if (resumeDir) {
        const result = await loadTranscript(resumeDir);
        if (result.success && result.events.length > 0) {
          const messages = rebuildSessionState(result.events);
          engineRef.current.loadMessages(messages);
          await sm.switchSession(resumeDir);
        }
      }
      setAgentContext({
        provider,
        sessionDir: sm.sessionDir ?? cwd,
        toolRegistry,
        permissionChecker,
      });
    }).catch(() => {
      // Even if session init fails, create engine with tools
      engineRef.current = new QueryEngine(provider, {
        tools: toolRegistry.toProviderTools(),
        toolRegistry,
        toolContext,
        permissionChecker,
      });
    });

    return () => {
      sm.close();
      disconnectAll().catch(() => {/* ignore cleanup errors */});
    };
  }, []);

  const addOutput = useCallback((line: OutputLine) => {
    setOutput((prev) => [...prev, line]);
  }, []);

  const handleCommand = useCallback(
    async (cmd: string): Promise<boolean> => {
      // Wait for engine initialization to complete
      if (engineInitRef.current) await engineInitRef.current;
      const sm = sessionManagerRef.current;
      const engine = engineRef.current;

      const ctx: CommandContext = {
        ...commandContext,
        model: currentModel,
        setModel: (m: string) => {
          setCurrentModel(m);
        },
        clearConversation: () => {
          engine.reset();
        },
        compactMessages: () => {
          engine.compact();
        },
        resumeSession: createResumeSession(engine, sm, sessionsBase, {
          provider,
          toolRegistry: toolRegistryRef.current ?? undefined,
          permissionChecker: permissionCheckerRef.current ?? undefined,
        }),
        rewindToEvent: createRewindToEvent(engine, sm, sessionsBase),
        config: {
          ...commandContext.config,
          sessionDir: sm.sessionDir ?? undefined,
          sessionsBase,
        },
      };

      const result = await commandRegistry.dispatch(cmd, ctx);
      addOutput(createCommandLine(result));

      return true;
    },
    [commandRegistry, commandContext, currentModel, addOutput, sessionsBase],
  );

  const handleSubmit = useCallback(async () => {
    const query = input.trim();
    if (!query) return;

    setInput("");

    // Add to command history
    setCommandHistory((prev) => [...prev, query]);
    setHistoryIndex(-1);

    addOutput(createUserLine(`> ${query}`));

    // Check if it's a slash command
    if (query.startsWith("/")) {
      await handleCommand(query);
      return;
    }

    // Wait for engine initialization to complete
    if (engineInitRef.current) await engineInitRef.current;
    const engine = engineRef.current;

    // Write user event to transcript
    await sessionManagerRef.current.appendUserEvent(query);

    // Create AbortController for this query
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Run through QueryEngine
    setStreaming(true);
    setEstimatedOutputTokens(0);
    let responseText = "";
    // Reset streaming buffer
    prevBufferRef.current = "";
    degradedRef.current = false;
    lastRenderRef.current = 0;
    // Track tool line index in output for status updates
    const toolLineIndices = new Map<string, number>();

    try {
      for await (const event of engine.query(query, { signal: abortController.signal })) {
        // Check if aborted
        if (abortController.signal.aborted) break;

        if (event.type === "text_delta") {
          responseText += event.text;
          // Estimate tokens from character count (~4 chars per token)
          const charCount = responseText.length;
          setEstimatedOutputTokens(Math.floor(charCount / 4));

          // Accumulate in buffer
          const newBuffer = (prevBufferRef.current ?? "") + event.text;
          prevBufferRef.current = newBuffer;

          // Throttle re-render
          const now = Date.now();
          const forceRender = event.text.includes("\n");
          if (forceRender || now - lastRenderRef.current >= THROTTLE_MS) {
            lastRenderRef.current = now;

            // Mark degraded if buffer exceeds threshold
            if (!degradedRef.current && newBuffer.length > DEGRADATION_THRESHOLD) {
              degradedRef.current = true;
            }

            setOutput((prev) => {
              const lastIdx = prev.length - 1;
              const last = prev[lastIdx];
              if (last?.type === "assistant") {
                return [...prev.slice(0, lastIdx), { ...last, content: newBuffer }];
              }
              return [...prev, createAssistantLine(newBuffer)];
            });
          }
        }
        if (event.type === "tool_call_start") {
          // Create a tool line and track its index
          const toolLine = createToolLine(event.id, event.name, "{}");
          setOutput((prev) => {
            toolLineIndices.set(event.id, prev.length);
            return [...prev, toolLine];
          });
        }
        if (event.type === "tool_call_args") {
          // Update tool params for the tracked tool line
          const idx = toolLineIndices.get(event.id);
          if (idx !== undefined) {
            setOutput((prev) => {
              const updated = [...prev];
              const existing = updated[idx];
              if (existing) {
                updated[idx] = updateToolParams(existing, event.args_json);
              }
              return updated;
            });
          }
        }
        if (event.type === "tool_call_result") {
          // Update tool status to success/error
          const idx = toolLineIndices.get(event.id);
          if (idx !== undefined) {
            setOutput((prev) => {
              const updated = [...prev];
              const existing = updated[idx];
              if (existing) {
                const state = event.isError ? "error" : "success";
                updated[idx] = updateToolStatus(existing, state, event.result);
              }
              return updated;
            });
          }
        }
        if (event.type === "error") {
          addOutput(createErrorLine(`Error: ${event.error.message}`));
        }
        if (event.type === "done") break;
      }

      if (responseText) {
        // Flush: ensure final buffer content is rendered (throttle may have skipped last update)
        setOutput((prev) => {
          const lastIdx = prev.length - 1;
          const last = prev[lastIdx];
          if (last?.type === "assistant" && last.content === responseText) {
            return prev; // already up to date
          }
          if (last?.type === "assistant") {
            return [...prev.slice(0, lastIdx), { ...last, content: responseText }];
          }
          return [...prev, createAssistantLine(responseText)];
        });

        // Write assistant event to transcript
        await sessionManagerRef.current.appendAssistantEvent(responseText);
        // Persist session memory if threshold reached
        const sm = sessionManagerRef.current;
        await persistSessionMemory(engine.getMessages(), sm.sessionDir, sm.isEnabled);
        // Auto-memory extraction → write to memoryDir
        const memoryConfig = commandContext.config?.memory as { autoMemoryEnabled?: boolean } | undefined;
        const cwd = (commandContext.config?.cwd as string) ?? process.cwd();
        await processAutoMemory(query, responseText, {
          persistenceEnabled: sm.isEnabled,
          autoMemoryEnabled: memoryConfig?.autoMemoryEnabled ?? true,
          cleanupPeriodDays,
          cwd,
          memoryDir: commandContext.config?.memoryDir as string | undefined,
          userConfigDir,
        });
      }

      // Show interrupted message if aborted
      if (abortController.signal.aborted) {
        addOutput(createSystemLine("Interrupted."));
      }
    } catch (e) {
      // If aborted, show interrupted message instead of error
      if (abortController.signal.aborted) {
        addOutput(createSystemLine("Interrupted."));
      } else {
        addOutput(createErrorLine(`Fatal: ${e instanceof Error ? e.message : String(e)}`));
      }
    } finally {
      abortControllerRef.current = null;
      setStreaming(false);
      setEstimatedOutputTokens(0);
    }
  }, [input, handleCommand, addOutput, cleanupPeriodDays, commandContext]);

  // Handle AskUser answer submission — collects answers one by one
  const handleAskSubmit = useCallback(() => {
    const answer = input.trim();
    if (!answer) return;

    const question = pendingAsk;
    if (!question) return;

    setInput("");
    const newAnswers = [...askAnswers, answer];
    const currentIdx = askIndex;
    const totalQuestions = question.questions.length;

    if (currentIdx + 1 < totalQuestions) {
      // More questions to answer — show current answer, advance to next
      addOutput(createSystemLine(`[AskUser] Q${currentIdx + 1}: ${question.questions[currentIdx]}`));
      addOutput(createSystemLine(`[AskUser] A${currentIdx + 1}: ${answer}`));
      setAskAnswers(newAnswers);
      setAskIndex(currentIdx + 1);
    } else {
      // All questions answered — submit
      addOutput(createSystemLine(`[AskUser] Q${currentIdx + 1}: ${question.questions[currentIdx]}`));
      addOutput(createSystemLine(`[AskUser] A${currentIdx + 1}: ${answer}`));
      submitAskUserAnswers(question.id, newAnswers);
      setPendingAsk(null);
      setAskIndex(0);
      setAskAnswers([]);
    }
  }, [input, pendingAsk, askIndex, askAnswers, addOutput]);

  // Handle AskUser cancel — cancels entire pending ask
  const handleAskCancel = useCallback(() => {
    if (!pendingAsk) return;
    cancelAskUser(pendingAsk.id);
    setPendingAsk(null);
    setAskIndex(0);
    setAskAnswers([]);
    addOutput(createSystemLine("[AskUser] Cancelled"));
  }, [pendingAsk, addOutput]);

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

    // AskUser mode: all input goes to answer (highest priority after Ctrl+C)
    if (pendingAsk) {
      if (key.escape) {
        handleAskCancel();
        return;
      }
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
      const commands = commandRegistry.list();
      const filtered = commands.filter(
        (cmd: Command) => cmd.name.includes(paletteFilter) || cmd.aliases?.some((a: string) => a.includes(paletteFilter)),
      );

      if (key.escape) {
        setShowPalette(false);
        setPaletteFilter("");
        setPaletteIndex(0);
        return;
      }
      if (key.upArrow) {
        setPaletteIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setPaletteIndex((prev) => Math.min(filtered.length - 1, prev + 1));
        return;
      }
      if (key.tab) {
        // Complete with selected command
        if (filtered.length > 0) {
          const selected = filtered[paletteIndex];
          if (selected) {
            setInput(`/${selected.name} `);
          }
          setShowPalette(false);
          setPaletteFilter("");
          setPaletteIndex(0);
        }
        return;
      }
      if (key.return) {
        const inputName = input.startsWith("/") ? input.slice(1).trim() : input;
        const selected = filtered[paletteIndex];

        if (selected && commandRegistry.has(inputName) && inputName === selected.name) {
          // Exact match — execute directly
          setShowPalette(false);
          setPaletteFilter("");
          setPaletteIndex(0);
          handleSubmit();
        } else if (selected) {
          // Prefix match — complete command name, don't execute
          setInput(`/${selected.name} `);
          setShowPalette(false);
          setPaletteFilter("");
          setPaletteIndex(0);
        }
        return;
      }
      // Backspace in palette: remove last char from input and filter
      if (key.backspace) {
        const newInput = input.slice(0, -1);
        setInput(newInput);
        const newFilter = newInput.startsWith("/") ? newInput.slice(1) : newInput;
        if (!newFilter) {
          setShowPalette(false);
        }
        setPaletteFilter(newFilter);
        setPaletteIndex(0);
        return;
      }
      // Regular typing in palette: update both input and filter
      if (ch && !key.ctrl && !key.meta) {
        const newInput = input + ch;
        setInput(newInput);
        // Derive filter from input (strip leading /)
        const newFilter = newInput.startsWith("/") ? newInput.slice(1) : newInput;
        setPaletteFilter(newFilter);
        setPaletteIndex(0);
        return;
      }
      return;
    }

    // ESC behavior: exit app
    if (key.escape) {
      exit();
      return;
    }

    // Enter behavior: normal submit
    if (key.return) {
      handleSubmit();
      return;
    }

    // History navigation on empty input
    if (key.upArrow && input === "" && commandHistory.length > 0) {
      const newIndex = historyIndex === -1
        ? commandHistory.length - 1
        : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setInput(commandHistory[newIndex] ?? "");
      return;
    }
    if (key.downArrow && input === "" && commandHistory.length > 0) {
      if (historyIndex === -1) return;
      const newIndex = historyIndex + 1;
      if (newIndex >= commandHistory.length) {
        setHistoryIndex(-1);
        setInput("");
      } else {
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex] ?? "");
      }
      return;
    }

    if (key.backspace) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    // Detect "/" to open palette
    if (ch === "/" && input === "") {
      setInput("/");
      setShowPalette(true);
      setPaletteFilter("");
      setPaletteIndex(0);
      return;
    }

    setInput((prev) => prev + ch);
  });

  // Get sessionId from session manager
  const sessionId = sessionManagerRef.current.sessionDir
    ? basename(sessionManagerRef.current.sessionDir)
    : null;

  return (
    <Box flexDirection="column">
      <TopBar model={currentModel} sessionId={sessionId} />
      <StartupPanel
        version={version ?? "0.0.0"}
        model={currentModel}
        cwd={(commandContext.config?.cwd as string) ?? process.cwd()}
      />
      {output.map((line, i) => {
        if (line.type === "tool" && line.toolStatus) {
          return (
            <Box key={i}>
              <ToolStatusLine status={line.toolStatus} />
            </Box>
          );
        }
        if (line.type === "assistant") {
          // Skip markdown rendering for large content (degradation threshold)
          if (line.content.length > DEGRADATION_THRESHOLD) {
            return <Box key={i}><Text>{line.content}</Text></Box>;
          }
          return <MarkdownBlock key={i} content={line.content} />;
        }
        // user, command, error, system lines render as Text
        const color =
          line.type === "user" ? "white" :
          line.type === "command" ? "cyan" :
          line.type === "error" ? "red" :
          line.type === "system" ? "dimColor" :
          undefined;
        return (
          <Box key={i}>
            <Text color={color}>{line.content}</Text>
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
          <Text color="yellow">[AskUser] ({askIndex + 1}/{pendingAsk.questions.length}) {pendingAsk.questions[askIndex]}</Text>
        </Box>
      )}
      {showPalette && (
        <CommandPalette
          commands={commandRegistry.list()}
          filter={paletteFilter}
          selectedIndex={paletteIndex}
        />
      )}
      <InputLine value={input} isAskMode={!!pendingAsk} />
      <BottomBar
        inputTokens={0}
        outputTokens={0}
        estimatedOutputTokens={estimatedOutputTokens > 0 ? estimatedOutputTokens : undefined}
      />
    </Box>
  );
}
