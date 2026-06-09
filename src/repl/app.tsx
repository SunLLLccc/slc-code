// Minimal Ink REPL — input box and streaming text output

import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { homedir } from "node:os";
import { join } from "node:path";
import { QueryEngine } from "../engine/engine.js";
import type { Provider } from "../engine/providers/base.js";
import type { StreamEvent } from "../engine/types.js";
import type { CommandRegistry, CommandContext } from "../commands/registry.js";
import { SessionManager } from "./session-manager.js";
import { createResumeSession, createRewindToEvent } from "./session-runtime.js";
import { assembleSystemPrompt } from "../prompt/assembly.js";
import { persistSessionMemory } from "../memory/session-memory-lifecycle.js";
import { processAutoMemory } from "../memory/auto-memory-lifecycle.js";
import { createBuiltinRegistry } from "../tools/builtin/registry-factory.js";
import { setAgentContext } from "../tools/builtin/agent.js";
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ReplAppProps {
  provider: Provider;
  commandRegistry: CommandRegistry;
  commandContext: CommandContext;
  initialModel?: string;
}

// ---------------------------------------------------------------------------
// ReplApp
// ---------------------------------------------------------------------------

export function ReplApp({
  provider,
  commandRegistry,
  commandContext,
  initialModel,
}: ReplAppProps) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [currentModel, setCurrentModel] = useState(initialModel ?? "");
  // Track pending AskUser questions for UI and input routing
  // Supports multi-question: tracks current index and collected answers
  const [pendingAsk, setPendingAsk] = useState<PendingQuestion | null>(null);
  const [askIndex, setAskIndex] = useState(0);
  const [askAnswers, setAskAnswers] = useState<string[]>([]);

  // Session manager — tracks current session, writes transcript
  const sessionConfig = commandContext.config?.session as { persistenceEnabled?: boolean; cleanupPeriodDays?: number } | undefined;
  const sessionsBase = (commandContext.config?.sessionsBase as string) ?? undefined;
  const persistenceEnabled = sessionConfig?.persistenceEnabled ?? true;
  const cleanupPeriodDays = sessionConfig?.cleanupPeriodDays ?? 30;
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
    const userConfigDir = join(homedir(), ".slc");

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

  const addOutput = useCallback((line: string) => {
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
      addOutput(result);

      return true;
    },
    [commandRegistry, commandContext, currentModel, addOutput, sessionsBase],
  );

  const handleSubmit = useCallback(async () => {
    const query = input.trim();
    if (!query) return;

    setInput("");
    addOutput(`> ${query}`);

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

    // Run through QueryEngine
    setStreaming(true);
    let responseText = "";

    try {
      for await (const event of engine.query(query)) {
        if (event.type === "text_delta") {
          responseText += event.text;
        }
        if (event.type === "error") {
          addOutput(`Error: ${event.error.message}`);
        }
        if (event.type === "done") break;
      }

      if (responseText) {
        addOutput(responseText);
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
        });
      }
    } catch (e) {
      addOutput(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStreaming(false);
    }
  }, [input, provider, handleCommand, addOutput]);

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
      addOutput(`[AskUser] Q${currentIdx + 1}: ${question.questions[currentIdx]}`);
      addOutput(`[AskUser] A${currentIdx + 1}: ${answer}`);
      setAskAnswers(newAnswers);
      setAskIndex(currentIdx + 1);
    } else {
      // All questions answered — submit
      addOutput(`[AskUser] Q${currentIdx + 1}: ${question.questions[currentIdx]}`);
      addOutput(`[AskUser] A${currentIdx + 1}: ${answer}`);
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
    addOutput("[AskUser] Cancelled");
  }, [pendingAsk, addOutput]);

  useInput((ch, key) => {
    // ESC behavior: cancel AskUser if pending, otherwise exit app
    if (key.escape) {
      if (pendingAsk) {
        handleAskCancel();
        return;
      }
      exit();
      return;
    }

    // Enter behavior: submit AskUser answer if pending, otherwise normal submit
    if (key.return) {
      if (pendingAsk) {
        handleAskSubmit();
        return;
      }
      handleSubmit();
      return;
    }

    if (key.backspace) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    setInput((prev) => prev + ch);
  });

  return (
    <Box flexDirection="column">
      {output.map((line, i) => (
        <Box key={i}>
          <Text>{line}</Text>
        </Box>
      ))}
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
      <Box>
        <Text color="green">{pendingAsk ? "❓ " : "❯ "}</Text>
        <Text>{input}</Text>
        <Text dimColor>█</Text>
      </Box>
    </Box>
  );
}
