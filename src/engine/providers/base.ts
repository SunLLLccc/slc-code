// Provider interface and mock provider

import type {
  ProviderMessage,
  ProviderTool,
  StreamEvent,
  ProviderCapabilities,
} from "../types.js";

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface Provider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  chat(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent>;
}

// ---------------------------------------------------------------------------
// Mock provider — yields predetermined text chunks, then done
// ---------------------------------------------------------------------------

export interface MockProviderOptions {
  /** Text chunks to yield as text_delta events. Default: ["Hello, world!"] */
  chunks?: string[];
  /** Capabilities to report. Default: all true. */
  capabilities?: Partial<ProviderCapabilities>;
}

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  toolUse: true,
  streaming: true,
  vision: true,
  promptCache: true,
  extendedThinking: true,
};

export class MockProvider implements Provider {
  readonly name = "mock";
  readonly capabilities: ProviderCapabilities;
  private readonly chunks: string[];

  constructor(options?: MockProviderOptions) {
    this.chunks = options?.chunks ?? ["Hello, world!"];
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options?.capabilities };
  }

  async *chat(
    _messages: ProviderMessage[],
    _tools: ProviderTool[],
    _signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    for (const chunk of this.chunks) {
      yield { type: "text_delta", text: chunk };
    }
    yield { type: "done", reason: "completed" };
  }
}
