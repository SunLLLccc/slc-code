// MCP Tool Loader — connect to MCP servers and register tools into the registry

import type { ToolRegistry } from "../registry.js";
import type { McpServerConfig } from "./client.js";
import { McpClient, McpError } from "./client.js";
import { adaptMcpTool } from "./adapter.js";
import { ConcurrencyLimiter } from "./concurrency.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadMcpToolsResult {
  connected: string[];
  failed: string[];
}

// ---------------------------------------------------------------------------
// Default concurrency limits
// ---------------------------------------------------------------------------

function defaultConcurrency(transport: string): number {
  switch (transport) {
    case "stdio":
      return 3;
    case "sse":
    case "http":
      return 20;
    default:
      return 3;
  }
}

// ---------------------------------------------------------------------------
// loadMcpToolsIntoRegistry
// ---------------------------------------------------------------------------

/**
 * Connect to each MCP server, list its tools, adapt them to the P5 Tool
 * interface, and register them into the registry.
 *
 * Built-in tools take priority (registerBuiltin evicts registerExternal).
 * Failed servers are skipped gracefully and reported in the result.
 */
export async function loadMcpToolsIntoRegistry(
  configs: McpServerConfig[],
  registry: ToolRegistry,
  options?: { concurrencyLimiter?: ConcurrencyLimiter },
): Promise<LoadMcpToolsResult> {
  const result: LoadMcpToolsResult = { connected: [], failed: [] };

  // Group configs by transport to choose appropriate concurrency limits
  // Use the provided limiter or create one per transport type
  const limiters = new Map<string, ConcurrencyLimiter>();

  function getLimiter(transport: string): ConcurrencyLimiter {
    if (options?.concurrencyLimiter) return options.concurrencyLimiter;
    let limiter = limiters.get(transport);
    if (!limiter) {
      limiter = new ConcurrencyLimiter(defaultConcurrency(transport));
      limiters.set(transport, limiter);
    }
    return limiter;
  }

  const tasks = configs.map((config) =>
    getLimiter(config.transport).run(async () => {
      const client = new McpClient(config);
      try {
        await client.connect();

        const mcpTools = await client.listTools();

        for (const mcpTool of mcpTools) {
          const tool = adaptMcpTool(mcpTool, config.name, client);
          registry.registerExternal(tool);
        }

        result.connected.push(config.name);
      } catch (err) {
        const message =
          err instanceof McpError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        console.error(
          `[mcp] Failed to load tools from "${config.name}": ${message}`,
        );
        result.failed.push(config.name);

        // Clean up on failure
        try {
          await client.disconnect();
        } catch {
          // Ignore disconnect errors during cleanup
        }
      }
    }),
  );

  await Promise.all(tasks);

  return result;
}
