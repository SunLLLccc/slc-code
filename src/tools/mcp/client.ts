// MCP Client — placeholder for MCP protocol integration (P12)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpServerConfig {
  name: string;
  transport: "stdio" | "sse" | "http";
  command?: string; // for stdio
  args?: string[]; // for stdio
  url?: string; // for sse/http
  env?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

export class McpClient {
  private readonly config: McpServerConfig;
  private connected = false;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  /** Placeholder — real MCP protocol handshake is deferred to a later phase. */
  async connect(): Promise<void> {
    this.connected = true;
  }

  /** Placeholder — tear down the transport. */
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  /** Placeholder — returns an empty list until real protocol support lands. */
  async listTools(): Promise<McpTool[]> {
    return [];
  }

  /** Whether the client is currently connected. */
  isConnected(): boolean {
    return this.connected;
  }
}
