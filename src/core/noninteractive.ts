// Non-interactive execution — --print and --stdin wired through QueryEngine

import type { Provider } from "../engine/providers/base.js";
import { QueryEngine } from "../engine/engine.js";
import type { StreamEvent } from "../engine/types.js";
import { assembleSystemPrompt } from "../prompt/assembly.js";
import { createBuiltinRegistry } from "../tools/builtin/registry-factory.js";
import { loadMcpToolsIntoRegistry, disconnectAll } from "../tools/mcp/loader.js";
import type { McpServerConfig } from "../tools/mcp/client.js";
import { getSharedAuthCache } from "../tools/mcp/auth-cache.js";
import { createPermissionChecker } from "../permissions/checker.js";
import { parseRule, type PermissionRule } from "../permissions/rules.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NonInteractiveResult {
  /** The text output from the model. */
  text: string;
  /** Whether an error occurred. */
  hasError: boolean;
  /** Error message if hasError is true. */
  errorMessage?: string;
  /** All events for optional streaming. */
  events: StreamEvent[];
}

// ---------------------------------------------------------------------------
// Execute a single query and collect the text result
// ---------------------------------------------------------------------------

/**
 * Run a single query in non-interactive mode.
 * Returns the collected text output and metadata.
 */
export async function executePrint(
  provider: Provider,
  query: string,
  options?: {
    signal?: AbortSignal;
    cwd?: string;
    userConfigDir?: string;
    skipPromptAssembly?: boolean;
    mcpServers?: Record<string, { transport: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> }>;
    permissions?: { allow?: string[]; deny?: string[]; ask?: string[] };
    permissionMode?: string;
  },
): Promise<NonInteractiveResult> {
  const cwd = options?.cwd ?? process.cwd();
  const systemPrompt = await assembleSystemPrompt({
    cwd,
    userConfigDir: options?.userConfigDir,
    skip: options?.skipPromptAssembly,
  });

  // Create registry and load MCP tools if configured
  // Entire MCP lifecycle wrapped in try/finally to guarantee cleanup
  const toolRegistry = createBuiltinRegistry();
  const authCache = getSharedAuthCache();
  const events: StreamEvent[] = [];
  let hasError = false;
  let errorMessage: string | undefined;

  try {
    if (options?.mcpServers) {
      const mcpConfigs: McpServerConfig[] = Object.entries(options.mcpServers).map(
        ([name, setting]) => ({ name, ...setting } as McpServerConfig),
      );
      await loadMcpToolsIntoRegistry(mcpConfigs, toolRegistry, { authCache }).catch(() => {/* logged by loader */});
    }

    // Create permission checker — in non-interactive mode, "ask" blocks (no UI to confirm)
    const permissionsConfig = options?.permissions;
    const configRules: PermissionRule[] = [
      ...(permissionsConfig?.deny ?? []).map((r) => parseRule(r, "deny")),
      ...(permissionsConfig?.ask ?? []).map((r) => parseRule(r, "ask")),
      ...(permissionsConfig?.allow ?? []).map((r) => parseRule(r, "allow")),
    ];
    const permissionChecker = createPermissionChecker({
      mode: (options?.permissionMode as any) ?? "default",
      rules: configRules,
      projectRoot: cwd,
    });

    const toolContext = { cwd };
    const engine = new QueryEngine(provider, {
      ...(systemPrompt ? { systemPrompt } : undefined),
      tools: toolRegistry.toProviderTools(),
      toolRegistry,
      toolContext,
      permissionChecker,
    });

    for await (const event of engine.query(query)) {
      events.push(event);

      if (event.type === "error") {
        hasError = true;
        errorMessage = event.error.message;
      }
    }
  } finally {
    // Always clean up MCP connections — even if load or query fails
    await disconnectAll().catch(() => {/* ignore cleanup errors */});
  }

  // Collect text from events
  let text = "";
  for (const event of events) {
    if (event.type === "text_delta") {
      text += event.text;
    }
    if (event.type === "done") break;
  }

  return { text, hasError, errorMessage, events };
}

/**
 * Read stdin and execute as a single query.
 * Returns the same result as executePrint.
 */
export async function executeStdin(
  provider: Provider,
  options?: {
    signal?: AbortSignal;
    cwd?: string;
    userConfigDir?: string;
    skipPromptAssembly?: boolean;
    mcpServers?: Record<string, { transport: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> }>;
    permissions?: { allow?: string[]; deny?: string[]; ask?: string[] };
    permissionMode?: string;
  },
): Promise<NonInteractiveResult> {
  const query = await readStdin();
  if (!query.trim()) {
    return {
      text: "",
      hasError: true,
      errorMessage: "No input from stdin",
      events: [],
    };
  }
  return executePrint(provider, query, options);
}

/** Read all of stdin as a string. */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
    // If stdin is not a pipe (e.g. terminal), resolve empty immediately
    if (process.stdin.isTTY) {
      resolve("");
    }
  });
}
