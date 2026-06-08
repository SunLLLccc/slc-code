// Tests for MCP client, adapter, auth cache, and registry priority

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpClient } from "../../src/tools/mcp/client.js";
import type { McpServerConfig, McpTool } from "../../src/tools/mcp/client.js";
import {
  adaptMcpTool,
  normalizeMcpToolName,
  truncateDescription,
} from "../../src/tools/mcp/adapter.js";
import { McpAuthCache } from "../../src/tools/mcp/auth-cache.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { createBuiltinRegistry } from "../../src/tools/builtin/registry-factory.js";

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

describe("McpClient", () => {
  const config: McpServerConfig = {
    name: "test-server",
    transport: "stdio",
    command: "echo",
    args: ["hello"],
  };

  it("constructor creates client with config", () => {
    const client = new McpClient(config);
    expect(client).toBeInstanceOf(McpClient);
    expect(client.isConnected()).toBe(false);
  });

  it("connect sets isConnected to true", async () => {
    const client = new McpClient(config);
    expect(client.isConnected()).toBe(false);
    await client.connect();
    expect(client.isConnected()).toBe(true);
  });

  it("disconnect sets isConnected to false", async () => {
    const client = new McpClient(config);
    await client.connect();
    expect(client.isConnected()).toBe(true);
    await client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  it("isConnected returns false initially", () => {
    const client = new McpClient(config);
    expect(client.isConnected()).toBe(false);
  });

  it("listTools returns empty array", async () => {
    const client = new McpClient(config);
    const tools = await client.listTools();
    expect(tools).toEqual([]);
  });

  it("listTools returns empty array even after connect", async () => {
    const client = new McpClient(config);
    await client.connect();
    const tools = await client.listTools();
    expect(tools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeMcpToolName
// ---------------------------------------------------------------------------

describe("normalizeMcpToolName", () => {
  it("produces mcp__{server}__{tool} format", () => {
    expect(normalizeMcpToolName("my-server", "tool")).toBe(
      "mcp__my-server__tool",
    );
  });

  it("sanitizes special characters in server name", () => {
    expect(normalizeMcpToolName("my.server@v1", "tool")).toBe(
      "mcp__my_server_v1__tool",
    );
  });

  it("sanitizes special characters in tool name", () => {
    expect(normalizeMcpToolName("server", "my.tool/func")).toBe(
      "mcp__server__my_tool_func",
    );
  });

  it("preserves alphanumeric, underscore, and dash", () => {
    expect(normalizeMcpToolName("server-1", "tool_name-2")).toBe(
      "mcp__server-1__tool_name-2",
    );
  });
});

// ---------------------------------------------------------------------------
// truncateDescription
// ---------------------------------------------------------------------------

describe("truncateDescription", () => {
  it("returns short string unchanged", () => {
    const desc = "short description";
    expect(truncateDescription(desc)).toBe(desc);
  });

  it("returns string at exactly maxLen unchanged", () => {
    const desc = "a".repeat(2048);
    expect(truncateDescription(desc)).toBe(desc);
  });

  it("truncates long string to 2048 chars with ellipsis", () => {
    const desc = "a".repeat(3000);
    const result = truncateDescription(desc);
    expect(result.length).toBe(2048);
    expect(result.endsWith("...")).toBe(true);
    expect(result.slice(0, 2045)).toBe("a".repeat(2045));
  });

  it("respects custom maxLen", () => {
    const desc = "a".repeat(100);
    const result = truncateDescription(desc, 10);
    expect(result.length).toBe(10);
    expect(result).toBe("aaaaaaa...");
  });

  it("returns string unchanged when shorter than custom maxLen", () => {
    const desc = "hello";
    expect(truncateDescription(desc, 10)).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// adaptMcpTool
// ---------------------------------------------------------------------------

describe("adaptMcpTool", () => {
  const mcpTool: McpTool = {
    name: "search",
    description: "Search the database",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  };

  it("creates Tool with correct normalized name", () => {
    const tool = adaptMcpTool(mcpTool, "my-server");
    expect(tool.name).toBe("mcp__my-server__search");
  });

  it("uses truncated description", () => {
    const tool = adaptMcpTool(mcpTool, "server");
    expect(tool.description).toBe("Search the database");
  });

  it("truncates long description", () => {
    const longTool: McpTool = {
      ...mcpTool,
      description: "x".repeat(3000),
    };
    const tool = adaptMcpTool(longTool, "server");
    expect(tool.description.length).toBe(2048);
    expect(tool.description.endsWith("...")).toBe(true);
  });

  it("copies inputSchema into schema.input", () => {
    const tool = adaptMcpTool(mcpTool, "server");
    expect(tool.schema.input).toEqual(mcpTool.inputSchema);
  });

  it("has security attributes: not readOnly", () => {
    const tool = adaptMcpTool(mcpTool, "server");
    expect(tool.security.readOnly).toBe(false);
  });

  it("has security attributes: not concurrencySafe", () => {
    const tool = adaptMcpTool(mcpTool, "server");
    expect(tool.security.concurrencySafe).toBe(false);
  });

  it("has security attributes: not destructive", () => {
    const tool = adaptMcpTool(mcpTool, "server");
    expect(tool.security.destructive).toBe(false);
  });

  it("execute returns 'MCP tool not connected' error", async () => {
    const tool = adaptMcpTool(mcpTool, "server");
    const result = await tool.execute({}, { cwd: "/tmp" });
    expect(result.output).toBe("MCP tool not connected");
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// McpAuthCache
// ---------------------------------------------------------------------------

describe("McpAuthCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("set/get stores and retrieves token", () => {
    const cache = new McpAuthCache();
    cache.set("server-a", "token-123");
    expect(cache.get("server-a")).toBe("token-123");
  });

  it("get returns null for missing server", () => {
    const cache = new McpAuthCache();
    expect(cache.get("nonexistent")).toBeNull();
  });

  it("get returns null for expired token", () => {
    const cache = new McpAuthCache();
    cache.set("server-a", "token", 5000);

    // Not yet expired
    expect(cache.get("server-a")).toBe("token");

    // Advance past TTL
    vi.advanceTimersByTime(5001);
    expect(cache.get("server-a")).toBeNull();
  });

  it("token without TTL does not expire", () => {
    const cache = new McpAuthCache();
    cache.set("server-a", "forever-token");

    // Advance a large amount of time
    vi.advanceTimersByTime(1_000_000_000);
    expect(cache.get("server-a")).toBe("forever-token");
  });

  it("markFailed blocks get for failureTtlMs (default 15 min)", () => {
    const cache = new McpAuthCache();
    cache.set("server-a", "token");
    expect(cache.get("server-a")).toBe("token");

    cache.markFailed("server-a");
    // Immediately after failure, get should return null
    expect(cache.get("server-a")).toBeNull();

    // Still blocked after 14 minutes
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(cache.get("server-a")).toBeNull();

    // Unblocked after 15 minutes + 1ms
    vi.advanceTimersByTime(60 * 1000 + 1);
    expect(cache.get("server-a")).toBe("token");
  });

  it("isBlocked returns true after markFailed within failureTtlMs", () => {
    const cache = new McpAuthCache();
    cache.set("server-a", "token");

    expect(cache.isBlocked("server-a")).toBe(false);

    cache.markFailed("server-a");
    expect(cache.isBlocked("server-a")).toBe(true);

    // Still blocked after 14 min
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(cache.isBlocked("server-a")).toBe(true);

    // Unblocked after 15 min + 1ms
    vi.advanceTimersByTime(60 * 1000 + 1);
    expect(cache.isBlocked("server-a")).toBe(false);
  });

  it("isBlocked returns false for server with no failure", () => {
    const cache = new McpAuthCache();
    expect(cache.isBlocked("never-failed")).toBe(false);
  });

  it("isBlocked returns false for unknown server", () => {
    const cache = new McpAuthCache();
    expect(cache.isBlocked("unknown")).toBe(false);
  });

  it("custom failureTtlMs is respected", () => {
    const cache = new McpAuthCache(1000); // 1 second
    cache.set("server-a", "token");

    cache.markFailed("server-a");
    expect(cache.isBlocked("server-a")).toBe(true);
    expect(cache.get("server-a")).toBeNull();

    // Unblocked after 1s + 1ms
    vi.advanceTimersByTime(1001);
    expect(cache.isBlocked("server-a")).toBe(false);
    expect(cache.get("server-a")).toBe("token");
  });

  it("clear resets all entries", () => {
    const cache = new McpAuthCache();
    cache.set("server-a", "token-a");
    cache.set("server-b", "token-b");
    expect(cache.get("server-a")).toBe("token-a");
    expect(cache.get("server-b")).toBe("token-b");

    cache.clear();
    expect(cache.get("server-a")).toBeNull();
    expect(cache.get("server-b")).toBeNull();
  });

  it("clear also removes failure state", () => {
    const cache = new McpAuthCache();
    cache.set("server-a", "token");
    cache.markFailed("server-a");
    expect(cache.isBlocked("server-a")).toBe(true);

    cache.clear();
    expect(cache.isBlocked("server-a")).toBe(false);
    expect(cache.get("server-a")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MCP + builtin registry priority
// ---------------------------------------------------------------------------

describe("MCP + builtin registry priority", () => {
  it("builtin tool wins over MCP tool with same name", () => {
    const registry = new ToolRegistry();

    const builtinTool = {
      name: "bash",
      description: "builtin bash",
      schema: { input: { type: "object" as const } },
      security: {
        readOnly: false,
        concurrencySafe: false,
        destructive: true,
      },
      execute: async () => ({ output: "builtin" }),
    };

    const mcpTool = adaptMcpTool(
      { name: "bash", description: "mcp bash", inputSchema: {} },
      "server",
    );

    // Register builtin first
    registry.registerBuiltin(builtinTool);
    registry.registerExternal(mcpTool);

    // builtin takes priority
    expect(registry.get("bash")).toBe(builtinTool);
    expect(registry.get("bash")!.description).toBe("builtin bash");
  });

  it("MCP tool with unique name registers successfully", () => {
    const registry = new ToolRegistry();

    const mcpTool = adaptMcpTool(
      { name: "search", description: "Search tool", inputSchema: {} },
      "my-server",
    );

    registry.registerExternal(mcpTool);

    expect(registry.has("mcp__my-server__search")).toBe(true);
    expect(registry.get("mcp__my-server__search")).toBe(mcpTool);
    expect(registry.listExternal()).toHaveLength(1);
  });

  it("builtin registration evicts previously registered MCP tool with same name", () => {
    const registry = new ToolRegistry();

    const mcpTool = {
      name: "grep",
      description: "mcp grep",
      schema: { input: { type: "object" as const } },
      security: {
        readOnly: false,
        concurrencySafe: false,
        destructive: false,
      },
      execute: async () => ({ output: "mcp" }),
    };

    const builtinTool = {
      name: "grep",
      description: "builtin grep",
      schema: { input: { type: "object" as const } },
      security: {
        readOnly: true,
        concurrencySafe: true,
        destructive: false,
      },
      execute: async () => ({ output: "builtin" }),
    };

    // MCP registered first
    registry.registerExternal(mcpTool);
    expect(registry.get("grep")).toBe(mcpTool);
    expect(registry.listExternal()).toHaveLength(1);

    // Builtin registered after — evicts MCP
    registry.registerBuiltin(builtinTool);
    expect(registry.get("grep")).toBe(builtinTool);
    expect(registry.listExternal()).toHaveLength(0);
    expect(registry.list()).toHaveLength(1);
  });

  it("createBuiltinRegistry produces a registry with builtins", () => {
    const registry = createBuiltinRegistry();
    // Should have all builtin tools registered
    expect(registry.listBuiltins().length).toBeGreaterThan(0);
    // Should be able to register MCP tools on top
    const mcpTool = adaptMcpTool(
      { name: "unique-tool", description: "MCP tool", inputSchema: {} },
      "server",
    );
    registry.registerExternal(mcpTool);
    expect(registry.has("mcp__server__unique-tool")).toBe(true);
  });
});
