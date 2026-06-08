// Tests for MCP client, adapter, auth cache, concurrency, and registry priority

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpClient, McpError } from "../../src/tools/mcp/client.js";
import type { McpServerConfig, McpTool } from "../../src/tools/mcp/client.js";
import {
  adaptMcpTool,
  normalizeMcpToolName,
  truncateDescription,
} from "../../src/tools/mcp/adapter.js";
import { McpAuthCache } from "../../src/tools/mcp/auth-cache.js";
import { ConcurrencyLimiter } from "../../src/tools/mcp/concurrency.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { executeSkill } from "../../src/skills/executor.js";
import type { Skill } from "../../src/skills/loader.js";

// ---------------------------------------------------------------------------
// Mock MCP SDK
// ---------------------------------------------------------------------------

const mockListTools = vi.fn();
const mockCallTool = vi.fn();
const mockConnect = vi.fn();
const mockClose = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    listTools: mockListTools,
    callTool: mockCallTool,
    close: mockClose,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));

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

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
  });

  it("constructor stores config and starts disconnected", () => {
    const client = new McpClient(config);
    expect(client).toBeInstanceOf(McpClient);
    expect(client.isConnected()).toBe(false);
  });

  it("connect() creates transport, instantiates Client, and calls connect", async () => {
    const client = new McpClient(config);
    expect(client.isConnected()).toBe(false);

    await client.connect();

    expect(mockConnect).toHaveBeenCalledOnce();
    expect(client.isConnected()).toBe(true);
  });

  it("disconnect() calls client.close() and resets connected state", async () => {
    const client = new McpClient(config);
    await client.connect();
    expect(client.isConnected()).toBe(true);

    await client.disconnect();

    expect(mockClose).toHaveBeenCalledOnce();
    expect(client.isConnected()).toBe(false);
  });

  it("listTools() returns tools from the MCP server", async () => {
    const serverTools = [
      { name: "search", description: "Search tool", inputSchema: { type: "object", properties: {} } },
      { name: "fetch", description: "Fetch data", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
    ];
    mockListTools.mockResolvedValue({ tools: serverTools });

    const client = new McpClient(config);
    await client.connect();
    const tools = await client.listTools();

    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({
      name: "search",
      description: "Search tool",
      inputSchema: { type: "object", properties: {} },
    });
    expect(tools[1].name).toBe("fetch");
  });

  it("callTool() returns result with content and isError from MCP server", async () => {
    mockCallTool.mockResolvedValue({
      content: [{ type: "text", text: "result data" }],
      isError: false,
    });

    const client = new McpClient(config);
    await client.connect();
    const result = await client.callTool("search", { query: "test" });

    expect(mockCallTool).toHaveBeenCalledWith({ name: "search", arguments: { query: "test" } });
    expect(result.content).toBe("result data");
    expect(result.isError).toBe(false);
  });

  it("callTool() joins multiple text content items with newline", async () => {
    mockCallTool.mockResolvedValue({
      content: [
        { type: "text", text: "line1" },
        { type: "text", text: "line2" },
      ],
      isError: false,
    });

    const client = new McpClient(config);
    await client.connect();
    const result = await client.callTool("multi", {});

    expect(result.content).toBe("line1\nline2");
  });

  it("callTool() serializes non-text content as JSON fallback", async () => {
    mockCallTool.mockResolvedValue({
      content: [{ type: "image", data: "base64..." }],
    });

    const client = new McpClient(config);
    await client.connect();
    const result = await client.callTool("img-tool", {});

    // Falls through to JSON.stringify of the entire result
    expect(result.content).toContain("image");
  });

  it("isConnected() reflects state transitions accurately", async () => {
    const client = new McpClient(config);
    expect(client.isConnected()).toBe(false);

    await client.connect();
    expect(client.isConnected()).toBe(true);

    // Connect again is idempotent
    await client.connect();
    expect(client.isConnected()).toBe(true);

    await client.disconnect();
    expect(client.isConnected()).toBe(false);

    // Disconnect again is idempotent
    await client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  it("listTools() throws McpError when not connected", async () => {
    const client = new McpClient(config);
    await expect(client.listTools()).rejects.toThrow(McpError);
    await expect(client.listTools()).rejects.toThrow(/not connected/);
  });

  it("callTool() throws McpError when not connected", async () => {
    const client = new McpClient(config);
    await expect(client.callTool("x", {})).rejects.toThrow(McpError);
  });

  it("connect() wraps SDK errors as McpError on failure", async () => {
    mockConnect.mockRejectedValue(new Error("connection refused"));

    const client = new McpClient(config);
    await expect(client.connect()).rejects.toThrow(McpError);
    await expect(client.connect()).rejects.toThrow(/connect failed/);
    expect(client.isConnected()).toBe(false);
  });

  it("connect() detects session expiry in error messages", async () => {
    mockConnect.mockRejectedValueOnce(new Error("HTTP 404 Not Found"));

    const client = new McpClient(config);
    await expect(client.connect()).rejects.toThrow(/Session expired/);
  });
});

// ---------------------------------------------------------------------------
// normalizeMcpToolName
// ---------------------------------------------------------------------------

describe("normalizeMcpToolName", () => {
  it("produces mcp__{server}__{tool} format for standard names", () => {
    expect(normalizeMcpToolName("my-server", "tool")).toBe(
      "mcp__my-server__tool",
    );
  });

  it("sanitizes special characters to underscores", () => {
    expect(normalizeMcpToolName("my.server@v1", "tool/func")).toBe(
      "mcp__my_server_v1__tool_func",
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

  it("truncates long string to 2048 chars with ellipsis", () => {
    const desc = "a".repeat(3000);
    const result = truncateDescription(desc);
    expect(result.length).toBe(2048);
    expect(result.endsWith("...")).toBe(true);
    expect(result.slice(0, 2045)).toBe("a".repeat(2045));
  });

  it("respects custom maxLen parameter", () => {
    const desc = "a".repeat(100);
    const result = truncateDescription(desc, 10);
    expect(result.length).toBe(10);
    expect(result).toBe("aaaaaaa...");
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

  it("creates tool with correct normalized name format", () => {
    const tool = adaptMcpTool(mcpTool, "my-server");
    expect(tool.name).toBe("mcp__my-server__search");
  });

  it("tool has security attributes set correctly", () => {
    const tool = adaptMcpTool(mcpTool, "server");
    expect(tool.security).toEqual({
      readOnly: false,
      concurrencySafe: false,
      destructive: false,
    });
  });

  it("execute calls client.callTool and returns result on success", async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({ content: "search results", isError: false }),
    } as unknown as McpClient;

    const tool = adaptMcpTool(mcpTool, "server", mockClient);
    const result = await tool.execute({ query: "hello" }, { cwd: "/tmp" });

    expect(mockClient.callTool).toHaveBeenCalledWith("search", { query: "hello" });
    expect(result.output).toBe("search results");
    expect(result.isError).toBe(false);
  });

  it("execute returns error output on callTool failure", async () => {
    const mockClient = {
      callTool: vi.fn().mockRejectedValue(new Error("server crashed")),
    } as unknown as McpClient;

    const tool = adaptMcpTool(mcpTool, "server", mockClient);
    const result = await tool.execute({ query: "bad" }, { cwd: "/tmp" });

    expect(result.output).toContain("MCP tool");
    expect(result.output).toContain("server crashed");
    expect(result.isError).toBe(true);
  });

  it("description truncation is applied to long descriptions", () => {
    const longTool: McpTool = {
      ...mcpTool,
      description: "x".repeat(3000),
    };
    const tool = adaptMcpTool(longTool, "server");
    expect(tool.description.length).toBe(2048);
    expect(tool.description.endsWith("...")).toBe(true);
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

  it("TTL expiry: token becomes null after ttlMs elapses", () => {
    const cache = new McpAuthCache();
    cache.set("server-a", "token", 5000);

    expect(cache.get("server-a")).toBe("token");

    vi.advanceTimersByTime(5001);
    expect(cache.get("server-a")).toBeNull();
  });

  it("markFailed blocks get even without prior set() (bug fix behavior)", () => {
    const cache = new McpAuthCache();
    // No prior set() — markFailed should create a minimal entry
    cache.markFailed("unknown-server");

    // get should return null (no token) and isBlocked should be true
    expect(cache.get("unknown-server")).toBeNull();
    expect(cache.isBlocked("unknown-server")).toBe(true);
  });

  it("isBlocked returns true after markFailed and false after failureTtlMs", () => {
    const cache = new McpAuthCache();
    cache.set("server-a", "token");
    expect(cache.isBlocked("server-a")).toBe(false);

    cache.markFailed("server-a");
    expect(cache.isBlocked("server-a")).toBe(true);

    // Still blocked after 14 minutes
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(cache.isBlocked("server-a")).toBe(true);

    // Unblocked after 15 minutes + 1ms
    vi.advanceTimersByTime(60 * 1000 + 1);
    expect(cache.isBlocked("server-a")).toBe(false);
    // Token should be retrievable again
    expect(cache.get("server-a")).toBe("token");
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

  it("clear resets all entries including failure state", () => {
    const cache = new McpAuthCache();
    cache.set("server-a", "token-a");
    cache.set("server-b", "token-b");
    cache.markFailed("server-a");

    cache.clear();

    expect(cache.get("server-a")).toBeNull();
    expect(cache.get("server-b")).toBeNull();
    expect(cache.isBlocked("server-a")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConcurrencyLimiter
// ---------------------------------------------------------------------------

describe("ConcurrencyLimiter", () => {
  it("runs tasks within limit concurrently", async () => {
    const limiter = new ConcurrencyLimiter(3);
    const order: number[] = [];

    const tasks = [1, 2, 3].map((id) =>
      limiter.run(async () => {
        order.push(id);
        return id;
      }),
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]); // All ran without queuing
  });

  it("queues tasks exceeding limit and runs them as slots free", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const running: number[] = [];
    const completed: number[] = [];

    // Block first two slots with slow promises
    const blocker1 = limiter.run(async () => {
      running.push(1);
      await new Promise((r) => setTimeout(r, 50));
      completed.push(1);
      return 1;
    });
    const blocker2 = limiter.run(async () => {
      running.push(2);
      await new Promise((r) => setTimeout(r, 50));
      completed.push(2);
      return 2;
    });

    // Third task should queue
    const queued = limiter.run(async () => {
      running.push(3);
      completed.push(3);
      return 3;
    });

    // Give time for first two to acquire, but not finish
    await new Promise((r) => setTimeout(r, 10));
    expect(running).toEqual([1, 2]); // Only first two started
    expect(limiter.getQueueSize()).toBe(1); // Third is queued

    const results = await Promise.all([blocker1, blocker2, queued]);
    expect(results).toEqual([1, 2, 3]);
    expect(completed).toContain(3); // Third eventually ran
  });

  it("releases slot after task completion", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const order: string[] = [];

    const t1 = limiter.run(async () => {
      order.push("start-1");
      await new Promise((r) => setTimeout(r, 20));
      order.push("end-1");
      return "a";
    });

    // Small delay to ensure t1 acquires the slot
    await new Promise((r) => setTimeout(r, 5));

    const t2 = limiter.run(async () => {
      order.push("start-2");
      return "b";
    });

    const results = await Promise.all([t1, t2]);
    expect(results).toEqual(["a", "b"]);
    expect(order).toEqual(["start-1", "end-1", "start-2"]);
  });

  it("getQueueSize reflects pending tasks", async () => {
    const limiter = new ConcurrencyLimiter(1);

    // Acquire the single slot
    const blocker = limiter.run(() => new Promise(() => {})); // never resolves

    await new Promise((r) => setTimeout(r, 5));
    expect(limiter.getQueueSize()).toBe(0);

    // Queue two tasks
    limiter.run(() => new Promise(() => {}));
    limiter.run(() => new Promise(() => {}));

    await new Promise((r) => setTimeout(r, 5));
    expect(limiter.getQueueSize()).toBe(2);
  });

  it("constructor throws for maxConcurrent less than 1", () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow("maxConcurrent must be at least 1");
    expect(() => new ConcurrencyLimiter(-1)).toThrow("maxConcurrent must be at least 1");
  });
});

// ---------------------------------------------------------------------------
// Builtin priority
// ---------------------------------------------------------------------------

describe("Builtin priority", () => {
  it("builtin tool wins over same-name MCP tool", () => {
    const registry = new ToolRegistry();

    const builtinTool = {
      name: "bash",
      description: "builtin bash",
      schema: { input: { type: "object" as const } },
      security: { readOnly: false, concurrencySafe: false, destructive: true },
      execute: async () => ({ output: "builtin" }),
    };

    const mcpTool = adaptMcpTool(
      { name: "bash", description: "mcp bash", inputSchema: {} },
      "server",
    );

    registry.registerBuiltin(builtinTool);
    registry.registerExternal(mcpTool);

    expect(registry.get("bash")).toBe(builtinTool);
    expect(registry.get("bash")!.description).toBe("builtin bash");
  });

  it("unique MCP tool name registers successfully", () => {
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
      security: { readOnly: false, concurrencySafe: false, destructive: false },
      execute: async () => ({ output: "mcp" }),
    };

    const builtinTool = {
      name: "grep",
      description: "builtin grep",
      schema: { input: { type: "object" as const } },
      security: { readOnly: true, concurrencySafe: true, destructive: false },
      execute: async () => ({ output: "builtin" }),
    };

    registry.registerExternal(mcpTool);
    expect(registry.get("grep")).toBe(mcpTool);
    expect(registry.listExternal()).toHaveLength(1);

    registry.registerBuiltin(builtinTool);
    expect(registry.get("grep")).toBe(builtinTool);
    expect(registry.listExternal()).toHaveLength(0);
    expect(registry.list()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// MCP skill shell interpolation
// ---------------------------------------------------------------------------

describe("MCP skill shell interpolation", () => {
  it("MCP source skill with allowShellInterpolation=false returns content as-is", async () => {
    const skill: Skill = {
      meta: {
        name: "mcp-skill",
        description: "A skill from MCP",
        source: "mcp",
        path: "/some/path",
        allowShellInterpolation: false,
      },
      content: "Hello `!echo world` this is literal",
    };

    const result = await executeSkill(skill, { cwd: "/tmp" });
    // Shell command is NOT executed; backtick pattern stays in output
    expect(result).toContain("`!echo world`");
    expect(result).toContain("literal");
  });

  it("MCP source skill with shell command is not executed even if content has backtick patterns", async () => {
    const skill: Skill = {
      meta: {
        name: "mcp-danger",
        description: "MCP skill with dangerous content",
        source: "mcp",
        path: "/some/path",
        // allowShellInterpolation is undefined (falsy) for MCP source
      },
      content: "Run `!rm -rf /` now",
    };

    const result = await executeSkill(skill, { cwd: "/tmp" });
    // The dangerous command is NOT executed — content returned as-is (after sanitization)
    expect(result).toContain("`!rm -rf /`");
    expect(result).toContain("now");
    // Crucially, the shell command pattern is preserved literally
    expect(result).toBe("Run `!rm -rf /` now");
  });
});
