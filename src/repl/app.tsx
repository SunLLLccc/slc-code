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

  // Initialize session + build system prompt + create QueryEngine
  useEffect(() => {
    const sm = sessionManagerRef.current;
    const cwd = (commandContext.config?.cwd as string) ?? process.cwd();
    const userConfigDir = join(homedir(), ".slc");

    engineInitRef.current = sm.cleanupAndInit(cleanupPeriodDays).then(async () => {
      const systemPrompt = await assembleSystemPrompt({ cwd, userConfigDir });
      const toolRegistry = createBuiltinRegistry();
      const toolContext = { cwd };
      engineRef.current = new QueryEngine(provider, {
        ...(systemPrompt ? { systemPrompt } : undefined),
        toolRegistry,
        toolContext,
      });
      // Wire AgentTool with provider and permissions
      setAgentContext({
        provider,
        sessionDir: sm.sessionDir ?? cwd,
        toolRegistry,
      });
    }).catch(() => {
      engineRef.current = new QueryEngine(provider);
    });

    return () => {
      sm.close();
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
        resumeSession: createResumeSession(engine, sm, sessionsBase),
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
        // Priority: config.memoryDir > project {cwd}/.slc/memory (no user fallback)
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

  useInput((ch, key) => {
    if (key.escape) {
      exit();
      return;
    }

    if (key.return) {
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
      <Box>
        <Text color="green">❯ </Text>
        <Text>{input}</Text>
        <Text dimColor>█</Text>
      </Box>
    </Box>
  );
}
