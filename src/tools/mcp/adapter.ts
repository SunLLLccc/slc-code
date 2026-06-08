// MCP Tool Adapter — convert MCP tools to the P5 Tool interface

import type { Tool, ToolOutput } from "../base.js";
import type { McpTool } from "./client.js";
import { McpClient } from "./client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a tool name into the `mcp__{serverName}__{toolName}` format. */
export function normalizeMcpToolName(
  serverName: string,
  toolName: string,
): string {
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp__${sanitize(serverName)}__${sanitize(toolName)}`;
}

/** Truncate a description string to `maxLen` characters (default 2048). */
export function truncateDescription(
  desc: string,
  maxLen: number = 2048,
): string {
  if (desc.length <= maxLen) return desc;
  return desc.slice(0, maxLen - 3) + "...";
}

// ---------------------------------------------------------------------------
// adaptMcpTool
// ---------------------------------------------------------------------------

/**
 * Convert an MCP tool definition into a P5 `Tool`.
 *
 * The returned tool's execute function calls the MCP server via the provided
 * client and returns the result.
 */
export function adaptMcpTool(
  mcpTool: McpTool,
  serverName: string,
  client: McpClient,
): Tool {
  const toolName = normalizeMcpToolName(serverName, mcpTool.name);

  return {
    name: toolName,
    description: truncateDescription(mcpTool.description),
    schema: {
      input: mcpTool.inputSchema,
    },
    security: {
      readOnly: false,
      concurrencySafe: false,
      destructive: false,
    },
    async execute(input): Promise<ToolOutput> {
      try {
        const result = await client.callTool(
          mcpTool.name,
          input as Record<string, unknown>,
        );
        return {
          output: result.content,
          isError: result.isError,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          output: `MCP tool "${toolName}" error: ${message}`,
          isError: true,
        };
      }
    },
  };
}
