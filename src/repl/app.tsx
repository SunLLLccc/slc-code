// Minimal Ink REPL — input box and streaming text output

import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { QueryEngine } from "../engine/engine.js";
import type { Provider } from "../engine/providers/base.js";
import type { StreamEvent } from "../engine/types.js";
import type { CommandRegistry, CommandContext } from "../commands/registry.js";

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

  // Persistent QueryEngine — survives across queries, reset on /clear
  const engineRef = useRef<QueryEngine>(new QueryEngine(provider));

  const addOutput = useCallback((line: string) => {
    setOutput((prev) => [...prev, line]);
  }, []);

  const handleCommand = useCallback(
    async (cmd: string): Promise<boolean> => {
      const ctx: CommandContext = {
        ...commandContext,
        model: currentModel,
        setModel: (m: string) => {
          setCurrentModel(m);
        },
        clearConversation: () => {
          engineRef.current.reset();
        },
      };

      const result = await commandRegistry.dispatch(cmd, ctx);
      addOutput(result);

      return true;
    },
    [commandRegistry, commandContext, currentModel, addOutput],
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

    // Run through QueryEngine
    setStreaming(true);
    let responseText = "";

    try {
      for await (const event of engineRef.current.query(query)) {
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
