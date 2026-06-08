// MCP Client — real MCP protocol integration using @modelcontextprotocol/sdk

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpServerConfig {
  name: string;
  transport: "stdio" | "sse" | "http" | "ws";
  command?: string;      // for stdio
  args?: string[];       // for stdio
  url?: string;          // for sse/http
  env?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Structured error for MCP operations. */
export class McpError extends Error {
  constructor(
    message: string,
    public readonly serverName: string,
    public readonly code?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "McpError";
  }
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

function timeoutPromise<T>(promise: Promise<T>, ms: number, serverName: string, operation: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new McpError(
        `${operation} timed out after ${ms}ms for server "${serverName}"`,
        serverName,
      ));
    }, ms);

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

export class McpClient {
  private readonly config: McpServerConfig;
  private client: Client | undefined;
  private transport: Transport | undefined;
  private _connected = false;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  /** Create the appropriate transport based on config.transport. */
  private createTransport(): Transport {
    switch (this.config.transport) {
      case "stdio": {
        if (!this.config.command) {
          throw new McpError(
            `"command" is required for stdio transport`,
            this.config.name,
          );
        }
        return new StdioClientTransport({
          command: this.config.command,
          args: this.config.args,
          env: this.config.env,
          stderr: "pipe",
        });
      }
      case "sse": {
        if (!this.config.url) {
          throw new McpError(
            `"url" is required for sse transport`,
            this.config.name,
          );
        }
        return new SSEClientTransport(new URL(this.config.url));
      }
      case "http": {
        if (!this.config.url) {
          throw new McpError(
            `"url" is required for http transport`,
            this.config.name,
          );
        }
        return new StreamableHTTPClientTransport(new URL(this.config.url));
      }
      case "ws": {
        if (!this.config.url) {
          throw new McpError(
            `"url" is required for ws transport`,
            this.config.name,
          );
        }
        return new WebSocketClientTransport(new URL(this.config.url));
      }
      default:
        throw new McpError(
          `Unknown transport: ${this.config.transport}`,
          this.config.name,
        );
    }
  }

  /** Connect to the MCP server. */
  async connect(timeoutMs: number = 30_000): Promise<void> {
    if (this._connected) return;

    try {
      this.transport = this.createTransport();
      this.client = new Client(
        { name: "slc-code", version: "1.0.0" },
        { capabilities: {} },
      );
      await timeoutPromise(
        this.client.connect(this.transport),
        timeoutMs,
        this.config.name,
        "connect",
      );
      this._connected = true;
    } catch (err) {
      this._connected = false;
      throw this.wrapError(err, "connect");
    }
  }

  /** Disconnect from the MCP server. */
  async disconnect(): Promise<void> {
    if (!this._connected) return;
    try {
      if (this.client) {
        await this.client.close();
      }
    } catch {
      // Ignore close errors
    } finally {
      this._connected = false;
      this.client = undefined;
      this.transport = undefined;
    }
  }

  /** List all tools provided by the MCP server. */
  async listTools(timeoutMs: number = 30_000): Promise<McpTool[]> {
    this.assertConnected("listTools");
    try {
      const result = await timeoutPromise(
        this.client!.listTools(),
        timeoutMs,
        this.config.name,
        "listTools",
      );
      return result.tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));
    } catch (err) {
      const mcpErr = this.wrapError(err, "listTools");
      if (mcpErr.code === -32001) {
        // Session expired — reconnect and retry once
        await this.disconnect();
        await this.connect(timeoutMs);
        const result = await timeoutPromise(
          this.client!.listTools(),
          timeoutMs,
          this.config.name,
          "listTools",
        );
        return result.tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          inputSchema: t.inputSchema as Record<string, unknown>,
        }));
      }
      throw mcpErr;
    }
  }

  /** Call a tool on the MCP server. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number = 60_000,
  ): Promise<{ content: string; isError?: boolean }> {
    this.assertConnected("callTool");
    try {
      const result = await timeoutPromise(
        this.client!.callTool({ name, arguments: args }),
        timeoutMs,
        this.config.name,
        `callTool(${name})`,
      );

      // Extract text content from the result.
      // The result has a `content` array with typed items.
      const callResult = result as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };

      if (Array.isArray(callResult.content)) {
        const texts = callResult.content
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text as string);
        return {
          content: texts.join("\n") || JSON.stringify(callResult.content),
          isError: callResult.isError,
        };
      }

      // Fallback: serialize the entire result
      return {
        content: JSON.stringify(result),
        isError: callResult.isError,
      };
    } catch (err) {
      const mcpErr = this.wrapError(err, `callTool(${name})`);
      if (mcpErr.code === -32001) {
        // Session expired — reconnect and retry once
        await this.disconnect();
        await this.connect(timeoutMs);
        const result = await timeoutPromise(
          this.client!.callTool({ name, arguments: args }),
          timeoutMs,
          this.config.name,
          `callTool(${name})`,
        );
        const callResult = result as {
          content?: Array<{ type: string; text?: string }>;
          isError?: boolean;
        };
        if (Array.isArray(callResult.content)) {
          const texts = callResult.content
            .filter((c) => c.type === "text" && typeof c.text === "string")
            .map((c) => c.text as string);
          return {
            content: texts.join("\n") || JSON.stringify(callResult.content),
            isError: callResult.isError,
          };
        }
        return {
          content: JSON.stringify(result),
          isError: callResult.isError,
        };
      }
      throw mcpErr;
    }
  }

  /** Whether the client is currently connected. */
  isConnected(): boolean {
    return this._connected;
  }

  /** Return the session ID if available (for session expiry detection). */
  getSessionId(): string | undefined {
    if (
      this.transport &&
      "sessionId" in this.transport &&
      typeof (this.transport as unknown as Record<string, unknown>).sessionId === "string"
    ) {
      return (this.transport as unknown as Record<string, unknown>).sessionId as string;
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private assertConnected(operation: string): void {
    if (!this._connected || !this.client) {
      throw new McpError(
        `Cannot ${operation}: not connected to server "${this.config.name}"`,
        this.config.name,
      );
    }
  }

  /** Wrap an unknown error into an McpError, detecting session expiry. */
  private wrapError(err: unknown, operation: string): McpError {
    if (err instanceof McpError) return err;

    const message = err instanceof Error ? err.message : String(err);

    // Detect session expiry: HTTP 404 or JSON-RPC -32001
    if (
      message.includes("404") ||
      message.includes("-32001") ||
      message.includes("session")
    ) {
      return new McpError(
        `Session expired for server "${this.config.name}": ${message}`,
        this.config.name,
        -32001,
        err,
      );
    }

    return new McpError(
      `${operation} failed for server "${this.config.name}": ${message}`,
      this.config.name,
      undefined,
      err,
    );
  }
}
