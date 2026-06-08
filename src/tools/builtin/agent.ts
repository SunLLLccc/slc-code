// AgentTool — dispatch a subagent to handle a task

import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { QueryEngine } from "../../engine/engine.js";
import type { Provider } from "../../engine/providers/base.js";
import { createSidechainWriter } from "../../session/transcript.js";

// ---------------------------------------------------------------------------
// Provider registry — set by the session manager at startup
// ---------------------------------------------------------------------------

let currentProvider: Provider | null = null;
let sessionDir: string | null = null;

/** Set the provider and session dir for subagent dispatch. */
export function setAgentProvider(provider: Provider, dir: string): void {
  currentProvider = provider;
  sessionDir = dir;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const agentTool: Tool = buildTool({
  name: "Agent",
  description: "Dispatch a subagent to handle a task",
  security: {
    readOnly: false,
    concurrencySafe: false,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Task description for the subagent",
        },
        subagentType: {
          type: "string",
          description: 'Type of subagent (e.g. "Explore", "Plan")',
        },
      },
      required: ["prompt"],
    },
  },
  validate(input: ToolInput): string | undefined {
    const prompt = input.prompt;
    if (typeof prompt !== "string" || prompt.trim() === "") {
      return "prompt must be a non-empty string";
    }
    return undefined;
  },
  checkPermissions(_input: ToolInput, _context: ToolContext) {
    return "allow" as const;
  },
  async execute(input: ToolInput, _context: ToolContext): Promise<ToolOutput> {
    if (!currentProvider) {
      return {
        output: "Agent tool not configured: no provider set",
        isError: true,
      };
    }

    const prompt = input.prompt as string;
    const subagentType = (input.subagentType as string | undefined) ?? "default";

    // 1. Create an isolated QueryEngine for the subagent
    const subEngine = new QueryEngine(currentProvider, {
      maxTurns: 10,
      systemPrompt: `You are a subagent of type "${subagentType}". Complete the assigned task and return a concise summary.`,
    });

    // 2. Run the prompt through the subagent
    let responseText = "";
    for await (const event of subEngine.query(prompt)) {
      if (event.type === "text_delta") {
        responseText += event.text;
      }
    }

    // 3. Write subagent transcript to sidechain
    if (sessionDir) {
      const subagentId = `agent-${Date.now()}`;
      const writer = createSidechainWriter(sessionDir, subagentId);
      await writer.append({
        uuid: crypto.randomUUID(),
        type: "user",
        timestamp: new Date().toISOString(),
        content: prompt,
        metadata: { subagentType },
      });
      await writer.append({
        uuid: crypto.randomUUID(),
        type: "assistant",
        timestamp: new Date().toISOString(),
        content: responseText,
        metadata: { subagentType },
      });
      writer.close();
    }

    return { output: responseText };
  },
});
