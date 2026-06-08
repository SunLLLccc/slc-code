// QueryEngine — stateful wrapper around the query loop

import type { ProviderMessage, ProviderTool, StreamEvent } from "./types.js";
import type { Provider } from "./providers/base.js";
import { query, type QueryOptions } from "./query.js";

export interface QueryEngineOptions {
  maxTurns?: number;
  tools?: ProviderTool[];
}

const DEFAULT_ENGINE_MAX_TURNS = 50;

export class QueryEngine {
  private readonly provider: Provider;
  private readonly maxTurns: number;
  private readonly tools: ProviderTool[];
  private readonly messages: ProviderMessage[] = [];

  constructor(provider: Provider, options?: QueryEngineOptions) {
    this.provider = provider;
    this.maxTurns = options?.maxTurns ?? DEFAULT_ENGINE_MAX_TURNS;
    this.tools = options?.tools ?? [];
  }

  /**
   * Send a user message and stream the response.
   * Messages are accumulated across calls.
   */
  async *query(userMessage: string): AsyncGenerator<StreamEvent> {
    this.messages.push({ role: "user", content: userMessage });

    const options: QueryOptions = {
      maxTurns: this.maxTurns,
      tools: this.tools,
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

  /** Clear the message history. */
  reset(): void {
    this.messages.length = 0;
  }
}
