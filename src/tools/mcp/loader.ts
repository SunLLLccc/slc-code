// MCP Tool Loader — connect to MCP servers and register tools into the registry

import type { ToolRegistry } from "../registry.js";
import type { McpServerConfig } from "./client.js";
import { McpClient, McpError } from "./client.js";
import { adaptMcpTool } from "./adapter.js";
import { ConcurrencyLimiter } from "./concurrency.js";
import type { McpAuthCache } from "./auth-cache.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadMcpToolsResult {
  connected: string[];
  failed: string[];
}

// ---------------------------------------------------------------------------
// Connection cache
// ---------------------------------------------------------------------------

const connectionCache = new Map<string, McpClient>();

function cacheKey(config: McpServerConfig): string {
  return config.name;
}

function getOrCreateClient(config: McpServerConfig): McpClient {
  const key = cacheKey(config);
  let client = connectionCache.get(key);
  if (!client) {
    client = new McpClient(config);
    connectionCache.set(key, client);
  }
  return client;
}

/** Disconnect all cached clients and clear the cache. */
export async function disconnectAll(): Promise<void> {
  const disconnects = Array.from(connectionCache.values()).map((c) =>
    c.disconnect().catch(() => {/* ignore */}),
  );
  await Promise.all(disconnects);
  connectionCache.clear();
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
    case "ws":
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
  options?: {
    concurrencyLimiter?: ConcurrencyLimiter;
    authCache?: McpAuthCache;
  },
): Promise<LoadMcpToolsResult> {
  const result: LoadMcpToolsResult = { connected: [], failed: [] };

  const tasks = configs.map((config) =>
    (async () => {
      // Check auth cache — skip if server is blocked
      if (options?.authCache?.isBlocked(config.name)) {
        console.error(
          `[mcp] Skipping "${config.name}" — auth failure block active`,
        );
        result.failed.push(config.name);
        return;
      }

      const client = getOrCreateClient(config);
      // Per-server concurrency limiter for tool calls
      const toolLimiter = new ConcurrencyLimiter(defaultConcurrency(config.transport));

      try {
        await client.connect();

        const mcpTools = await client.listTools();

        for (const mcpTool of mcpTools) {
          const tool = adaptMcpTool(mcpTool, config.name, client, toolLimiter);
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

        // Record auth failure in cache
        if (err instanceof McpError && err.code === -32001) {
          options?.authCache?.markFailed(config.name);
        }

        // Remove from cache on failure so next attempt gets a fresh client
        connectionCache.delete(cacheKey(config));
        // Clean up the failed client
        try {
          await client.disconnect();
        } catch {
          // Ignore disconnect errors during cleanup
        }
      }
    })(),
  );

  await Promise.all(tasks);

  return result;
}
