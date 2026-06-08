// Context Manager — token estimation and compact trigger

import type { ProviderMessage } from "../engine/types.js";

export interface ContextState {
  /** Current file being viewed/edited */
  currentFile?: string;
  /** Plan state (if in plan mode) */
  planState?: string;
  /** Active MCP tools */
  mcpTools?: string[];
  /** Tool declarations for re-injection */
  toolDeclarations?: Record<string, unknown>;
}

const DEFAULT_MAX_TOKENS = 100_000;
const CHARS_PER_TOKEN = 4;

export class ContextManager {
  private readonly maxTokens: number;
  private state: ContextState = {};

  constructor(maxTokens?: number) {
    this.maxTokens = maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  /** Rough token estimate: ~4 chars per token. */
  estimateTokens(messages: ProviderMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      if ("content" in msg && typeof msg.content === "string") {
        totalChars += msg.content.length;
      }
      if ("result" in msg && typeof msg.result === "string") {
        totalChars += msg.result.length;
      }
    }
    return Math.ceil(totalChars / CHARS_PER_TOKEN);
  }

  /** Returns true when the conversation likely exceeds the context window. */
  shouldCompact(messages: ProviderMessage[]): boolean {
    return this.estimateTokens(messages) > this.maxTokens;
  }

  getState(): ContextState {
    return { ...this.state };
  }

  setState(state: ContextState): void {
    this.state = { ...state };
  }
}
