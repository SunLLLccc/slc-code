// MCP / Skills e2e tests — real loadMcpToolsIntoRegistry with mocked MCP SDK
//
// Tests the full chain: config → loadMcpToolsIntoRegistry → McpClient.connect →
// listTools → adaptMcpTool → registry.registerExternal → QueryEngine tool call → tool_result

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolRegistry } from "../../src/tools/registry.js";
import { normalizeMcpToolName } from "../../src/tools/mcp/adapter.js";
import { McpAuthCache, resetSharedAuthCache } from "../../src/tools/mcp/auth-cache.js";
import { loadMcpToolsIntoRegistry, disconnectAll } from "../../src/tools/mcp/loader.js";
import { createBuiltinRegistry } from "../../src/tools/builtin/registry-factory.js";
import { QueryEngine } from "../../src/engine/engine.js";
import { discoverSkills, clearDiscoveryCache } from "../../src/skills/discovery.js";
import { executeSkill } from "../../src/skills/executor.js";
import type { Skill } from "../../src/skills/loader.js";
import type { McpServerConfig } from "../../src/tools/mcp/client.js";
import type { Provider, StreamEvent } from "../../src/engine/types.js";

// ---------------------------------------------------------------------------
// Mock MCP SDK — intercept connect/listTools/callTool at the SDK level
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

vi.mock("@modelcontextprotocol/sdk/client/websocket.js", () => ({
  WebSocketClientTransport: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-e2e-mcp-"));
  resetSharedAuthCache();
  clearDiscoveryCache();
  vi.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockClose.mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
  resetSharedAuthCache();
  clearDiscoveryCache();
  await disconnectAll();
});

// ---------------------------------------------------------------------------
// Tests — real loadMcpToolsIntoRegistry chain
// ---------------------------------------------------------------------------

describe("MCP — real loadMcpToolsIntoRegistry chain", () => {
  it("config → connect → listTools → adapt → register → registry has mcp__server__tool", async () => {
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: "search",
          description: "Search the web",
          inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      ],
    });

    const registry = new ToolRegistry();
    const configs: McpServerConfig[] = [
      { name: "web-server", transport: "stdio", command: "echo" },
    ];

    const result = await loadMcpToolsIntoRegistry(configs, registry);

    expect(result.connected).toEqual(["web-server"]);
    expect(result.failed).toEqual([]);

    // SDK connect was called
    expect(mockConnect).toHaveBeenCalled();
    expect(mockListTools).toHaveBeenCalled();

    // Registry has the MCP tool
    const toolName = normalizeMcpToolName("web-server", "search");
    expect(registry.has(toolName)).toBe(true);
    const tool = registry.get(toolName);
    expect(tool!.name).toBe(toolName);
    expect(tool!.description).toBe("Search the web");
  });

  it("builtin tools take priority over MCP tools with same name", async () => {
    mockListTools.mockResolvedValue({
      tools: [
        { name: "FileRead", description: "MCP FileRead", inputSchema: { type: "object" } },
      ],
    });

    const registry = createBuiltinRegistry();
    const configs: McpServerConfig[] = [
      { name: "dup-server", transport: "stdio", command: "echo" },
    ];

    await loadMcpToolsIntoRegistry(configs, registry);

    // The builtin FileRead should still be the primary one
    const fileRead = registry.get("FileRead");
    expect(fileRead).toBeDefined();
    expect(fileRead!.description).not.toBe("MCP FileRead");

    // The MCP version should be registered under its normalized name
    expect(registry.has("mcp__dup-server__FileRead")).toBe(true);
  });

  it("failed server is reported and not in registry", async () => {
    mockConnect.mockRejectedValueOnce(new Error("connection refused"));

    const registry = new ToolRegistry();
    const configs: McpServerConfig[] = [
      { name: "bad-server", transport: "stdio", command: "nonexistent" },
    ];

    const result = await loadMcpToolsIntoRegistry(configs, registry);

    expect(result.connected).toEqual([]);
    expect(result.failed).toEqual(["bad-server"]);
    expect(registry.has("mcp__bad-server__any")).toBe(false);
  });

  it("auth cache blocks subsequent connections after auth failure", async () => {
    const authErr = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    mockConnect.mockRejectedValueOnce(authErr);

    const authCache = new McpAuthCache();
    const registry = new ToolRegistry();
    const configs: McpServerConfig[] = [
      { name: "auth-server", transport: "stdio", command: "echo" },
    ];

    // First attempt fails with auth error
    const result1 = await loadMcpToolsIntoRegistry(configs, registry, { authCache });
    expect(result1.failed).toEqual(["auth-server"]);
    expect(authCache.isBlocked("auth-server")).toBe(true);

    // Second attempt skips the server due to auth block
    mockConnect.mockClear();
    const result2 = await loadMcpToolsIntoRegistry(configs, registry, { authCache });
    expect(result2.failed).toEqual(["auth-server"]);
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — MCP tool execution via QueryEngine
// ---------------------------------------------------------------------------

describe("MCP — QueryEngine tool call integration", () => {
  it("provider emits MCP tool call → scheduler executes → tool_result returned", async () => {
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: "lookup",
          description: "Look up a value",
          inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
        },
      ],
    });
    mockCallTool.mockResolvedValue({
      content: [{ type: "text", text: "found: 42" }],
    });

    const registry = new ToolRegistry();
    const configs: McpServerConfig[] = [
      { name: "db-server", transport: "stdio", command: "echo" },
    ];

    await loadMcpToolsIntoRegistry(configs, registry);

    const mcpToolName = normalizeMcpToolName("db-server", "lookup");

    // Provider that emits MCP tool call in round 1
    let round = 0;
    const provider: Provider = {
      name: "mcp-test",
      capabilities: { toolUse: true, streaming: true, vision: false, promptCache: false, extendedThinking: false },
      defaultModel: "test",
      async *chat() {
        round++;
        if (round === 1) {
          yield { type: "tool_call_start" as const, id: "tc-1", name: mcpToolName };
          yield { type: "tool_call_args" as const, id: "tc-1", args_json: '{"key":"answer"}' };
        } else {
          yield { type: "text_delta" as const, text: "The answer is 42" };
          yield { type: "done" as const, reason: "completed" as const };
        }
      },
    };

    const engine = new QueryEngine(provider, {
      tools: registry.toProviderTools(),
      toolRegistry: registry,
      toolContext: { cwd: testDir },
    });

    const events: StreamEvent[] = [];
    for await (const event of engine.query("look up the answer")) {
      events.push(event);
    }

    // SDK callTool was called with correct args
    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "lookup", arguments: { key: "answer" } }),
    );

    // tool_call_result contains MCP response
    const toolResults = events.filter((e) => e.type === "tool_call_result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].result).toContain("found: 42");
    expect(toolResults[0].isError).toBeFalsy();

    // Final text response
    const textEvents = events.filter((e) => e.type === "text_delta");
    expect(textEvents.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — Skill discovery and execution
// ---------------------------------------------------------------------------

describe("Skill discovery", () => {
  it("finds project skills in .slc/skills/", async () => {
    const skillDir = join(testDir, ".slc", "skills", "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: my-skill
description: A test skill
---
Skill content here.`,
    );

    const skills = await discoverSkills({
      projectRoot: testDir,
      userConfigDir: join(testDir, "user-config"),
    });

    expect(skills.length).toBeGreaterThanOrEqual(1);
    const found = skills.find((s) => s.name === "my-skill");
    expect(found).toBeDefined();
    expect(found!.source).toBe("project");
  });
});

describe("Skill execution", () => {
  it("returns content for untrusted source without shell interpolation", async () => {
    const skill: Skill = {
      meta: { name: "mcp-skill", description: "", source: "mcp", path: testDir, allowShellInterpolation: false },
      content: "Hello from MCP skill",
    };
    const result = await executeSkill(skill, { cwd: testDir });
    expect(result).toBe("Hello from MCP skill");
  });

  it("interpolates shell for trusted source", async () => {
    const skill: Skill = {
      meta: { name: "proj-skill", description: "", source: "project", path: testDir, allowShellInterpolation: true },
      content: "Dir: `!pwd`",
    };
    const result = await executeSkill(skill, { cwd: testDir });
    expect(result).toContain(testDir);
  });
});

// ---------------------------------------------------------------------------
// Tests — McpAuthCache
// ---------------------------------------------------------------------------

describe("McpAuthCache", () => {
  it("set/get/markFailed/isBlocked cycle", () => {
    const cache = new McpAuthCache();
    expect(cache.get("s1")).toBeNull();
    expect(cache.isBlocked("s1")).toBe(false);

    cache.set("s1", "token");
    expect(cache.get("s1")).toBe("token");
    expect(cache.isBlocked("s1")).toBe(false);

    cache.markFailed("s1");
    expect(cache.get("s1")).toBeNull();
    expect(cache.isBlocked("s1")).toBe(true);
  });
});
