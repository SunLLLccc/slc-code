// MCP Tool Adapter — convert MCP tools to the P5 Tool interface

import type { Tool } from "../base.js";
import type { McpTool } from "./client.js";

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
 * The returned tool is a **placeholder** — its execute function returns a
 * static message until real MCP protocol support is wired up.
 */
export function adaptMcpTool(mcpTool: McpTool, serverName: string): Tool {
  return {
    name: normalizeMcpToolName(serverName, mcpTool.name),
    description: truncateDescription(mcpTool.description),
    schema: {
      input: mcpTool.inputSchema,
    },
    security: {
      readOnly: false,
      concurrencySafe: false,
      destructive: false,
    },
    async execute() {
      return {
        output: "MCP tool not connected",
        isError: true,
      };
    },
  };
}
