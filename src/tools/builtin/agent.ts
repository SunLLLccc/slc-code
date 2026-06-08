// AgentTool — dispatch a subagent to handle a task
// Child permissions are equal to or narrower than parent

import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { QueryEngine } from "../../engine/engine.js";
import type { Provider } from "../../engine/providers/base.js";
import type { ToolRegistry } from "../registry.js";
import type { PermissionChecker } from "../scheduler.js";
import { createSidechainWriter } from "../../session/transcript.js";

// ---------------------------------------------------------------------------
// Provider/permission registry — set by the session manager at startup
// ---------------------------------------------------------------------------

let currentProvider: Provider | null = null;
let currentSessionDir: string | null = null;
let parentToolRegistry: ToolRegistry | null = null;
let parentPermissionChecker: PermissionChecker | null = null;

/**
 * Set the provider, session dir, and permission context for subagent dispatch.
 * Child agents inherit the parent's tool registry and permission checker,
 * ensuring they cannot gain permissions the parent doesn't have.
 */
export function setAgentContext(ctx: {
  provider: Provider;
  sessionDir: string;
  toolRegistry?: ToolRegistry;
  permissionChecker?: PermissionChecker;
}): void {
  currentProvider = ctx.provider;
  currentSessionDir = ctx.sessionDir;
  parentToolRegistry = ctx.toolRegistry ?? null;
  parentPermissionChecker = ctx.permissionChecker ?? null;
}

/** Reset agent context (for testing). */
export function resetAgentContext(): void {
  currentProvider = null;
  currentSessionDir = null;
  parentToolRegistry = null;
  parentPermissionChecker = null;
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
    //    Child inherits parent's tool registry and permission checker (no new permissions)
    const subEngine = new QueryEngine(currentProvider, {
      maxTurns: 10,
      systemPrompt: `You are a subagent of type "${subagentType}". Complete the assigned task and return a concise summary.`,
      toolRegistry: parentToolRegistry ?? undefined,
      permissionChecker: parentPermissionChecker ?? undefined,
      toolContext: { cwd: _context.cwd },
    });

    // 2. Run the prompt through the subagent
    let responseText = "";
    for await (const event of subEngine.query(prompt)) {
      if (event.type === "text_delta") {
        responseText += event.text;
      }
    }

    // 3. Write subagent transcript to sidechain
    if (currentSessionDir) {
      const subagentId = `agent-${Date.now()}`;
      const writer = createSidechainWriter(currentSessionDir, subagentId);
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
