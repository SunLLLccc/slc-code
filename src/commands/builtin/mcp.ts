// /mcp — show MCP server status from the registry

import type { Command, CommandContext } from "../registry.js";

export interface McpStatusProvider {
  getConnectedServers(): Array<{ name: string; toolCount: number }>;
  getFailedServers(): string[];
}

/** Module-level MCP status provider — injected by the startup code. */
let statusProvider: McpStatusProvider | null = null;

export function setMcpStatusProvider(provider: McpStatusProvider): void {
  statusProvider = provider;
}

export const mcpCommand: Command = {
  name: "mcp",
  description: "Show MCP server status",
  execute(_args: string, _context: CommandContext): string {
    if (!statusProvider) {
      return "MCP status: no MCP status provider configured. MCP servers are not loaded in this session.";
    }

    const connected = statusProvider.getConnectedServers();
    const failed = statusProvider.getFailedServers();

    if (connected.length === 0 && failed.length === 0) {
      return "MCP: No servers configured.";
    }

    const lines: string[] = ["MCP Servers:"];

    for (const server of connected) {
      lines.push(`  [connected] ${server.name} — ${server.toolCount} tool(s)`);
    }

    for (const name of failed) {
      lines.push(`  [failed] ${name}`);
    }

    return lines.join("\n");
  },
};
