// QueryEngine — stateful wrapper around the query loop

import type { ProviderMessage, ProviderTool, StreamEvent } from "./types.js";
import type { Provider } from "./providers/base.js";
import { query, type QueryOptions } from "./query.js";
import { ContextManager } from "../context/manager.js";
import { compactMessages } from "../context/compact.js";
import { buildReinjectMessages } from "../context/re-inject.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { PermissionChecker } from "../tools/scheduler.js";
import type { ToolContext } from "../tools/base.js";

export interface QueryEngineOptions {
  maxTurns?: number;
  tools?: ProviderTool[];
  /** System prompt to prepend to all queries */
  systemPrompt?: string;
  /** Maximum tokens before auto-compact triggers */
  maxTokens?: number;
  /** Tool registry for executing tool calls */
  toolRegistry?: ToolRegistry;
  /** Permission checker for tool execution */
  permissionChecker?: PermissionChecker;
  /** Tool context (cwd, etc.) */
  toolContext?: ToolContext;
}

const DEFAULT_ENGINE_MAX_TURNS = 50;

export class QueryEngine {
  private readonly provider: Provider;
  private readonly maxTurns: number;
  private readonly tools: ProviderTool[];
  private readonly messages: ProviderMessage[] = [];
  private readonly systemPrompt: string | undefined;
  private readonly contextManager: ContextManager;
  private readonly toolRegistry: ToolRegistry | undefined;
  private readonly permissionChecker: PermissionChecker | undefined;
  private readonly toolContext: ToolContext | undefined;

  constructor(provider: Provider, options?: QueryEngineOptions) {
    this.provider = provider;
    this.maxTurns = options?.maxTurns ?? DEFAULT_ENGINE_MAX_TURNS;
    this.tools = options?.tools ?? [];
    this.systemPrompt = options?.systemPrompt;
    this.contextManager = new ContextManager(options?.maxTokens);
    this.toolRegistry = options?.toolRegistry;
    this.permissionChecker = options?.permissionChecker;
    this.toolContext = options?.toolContext;
  }

  /**
   * Send a user message and stream the response.
   * Messages are accumulated across calls.
   * Auto-compacts if token budget exceeded.
   */
  async *query(userMessage: string): AsyncGenerator<StreamEvent> {
    // Inject system prompt if not already present
    if (this.systemPrompt && (this.messages.length === 0 || this.messages[0]?.role !== "system")) {
      this.messages.unshift({ role: "system", content: this.systemPrompt });
    }

    this.messages.push({ role: "user", content: userMessage });

    // Auto-compact check
    if (this.contextManager.shouldCompact(this.messages)) {
      this.performCompact();
    }

    const options: QueryOptions = {
      maxTurns: this.maxTurns,
      tools: this.tools,
      toolRegistry: this.toolRegistry,
      permissionChecker: this.permissionChecker,
      toolContext: this.toolContext,
    };

    let assistantText = "";

    for await (const event of query(this.provider, this.messages, options)) {
      if (event.type === "text_delta") {
        assistantText += event.text;
      }
      yield event;
    }

    // Record the assistant response in our message history
    if (assistantText) {
      this.messages.push({ role: "assistant", content: assistantText });
    }
  }

  /** Return a snapshot of the accumulated message history. */
  getMessages(): ProviderMessage[] {
    return [...this.messages];
  }

  /**
   * Load messages from an external source (e.g. resume).
   * Replaces current message history entirely.
   */
  loadMessages(messages: ProviderMessage[]): void {
    this.messages.length = 0;
    this.messages.push(...messages);
  }

  /**
   * Replace messages (e.g. after compact or rewind).
   */
  replaceMessages(messages: ProviderMessage[]): void {
    this.messages.length = 0;
    this.messages.push(...messages);
  }

  /**
   * Compact conversation history.
   */
  compact(): void {
    this.performCompact();
  }

  private performCompact(): void {
    const compacted = compactMessages(this.messages);
    const reinject = buildReinjectMessages(this.contextManager.getState());
    this.messages.length = 0;
    this.messages.push(...compacted, ...reinject);
  }

  /** Get the context manager for state tracking. */
  getContextManager(): ContextManager {
    return this.contextManager;
  }

  /** Clear the message history. */
  reset(): void {
    this.messages.length = 0;
  }
}
