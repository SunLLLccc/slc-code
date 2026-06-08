// OpenAI-compatible provider — for local models (Ollama, vLLM, LMStudio, etc.)
// Uses the openai SDK with a custom baseURL and conservative capabilities.

import OpenAI from "openai";
import type {
  ProviderMessage,
  ProviderTool,
  StreamEvent,
  ProviderCapabilities,
} from "../types.js";
import type { Provider } from "./base.js";
import { OpenAIProvider } from "./openai.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenAICompatibleProviderOptions {
  apiKey?: string;
  model: string;
  baseURL: string;
  /** Max output tokens. Default: 4096. */
  maxTokens?: number;
  /** Explicit capabilities (skip probe). */
  capabilities?: Partial<ProviderCapabilities>;
}

// ---------------------------------------------------------------------------
// Conservative baseline
// ---------------------------------------------------------------------------

export const CONSERVATIVE_CAPS: ProviderCapabilities = {
  toolUse: false,
  streaming: true,
  vision: false,
  promptCache: false,
  extendedThinking: false,
};

// ---------------------------------------------------------------------------
// Capability probe
// ---------------------------------------------------------------------------

/**
 * Attempt to detect provider capabilities by sending targeted probe requests.
 *
 * Strategy:
 *  1. Send a plain text request to confirm the endpoint is reachable.
 *     This only confirms streaming + text — does NOT enable toolUse.
 *  2. Send a request with a dummy tool/function definition.
 *     Only if this succeeds do we set toolUse=true.
 *  3. Any failure falls back to conservative (text-only + streaming).
 */
export async function probeCapabilities(
  client: OpenAI,
  model: string,
): Promise<ProviderCapabilities> {
  // Step 1: Basic connectivity — confirms endpoint is alive
  try {
    await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    });
  } catch {
    // Can't reach the endpoint at all — fully conservative
    return { ...CONSERVATIVE_CAPS };
  }

  // Step 2: Tool/function calling probe — only set toolUse=true if confirmed
  try {
    await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "test" }],
      max_tokens: 1,
      tools: [
        {
          type: "function" as const,
          function: {
            name: "__slc_probe",
            description: "Connectivity probe — ignore",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });
    // Tool probe succeeded — endpoint supports function calling
    return { ...CONSERVATIVE_CAPS, toolUse: true };
  } catch {
    // Tool probe failed — endpoint doesn't support function calling
    return { ...CONSERVATIVE_CAPS };
  }
}

// ---------------------------------------------------------------------------
// OpenAICompatibleProvider
// ---------------------------------------------------------------------------

export class OpenAICompatibleProvider implements Provider {
  readonly name = "openai-compatible";
  readonly capabilities: ProviderCapabilities;

  private readonly delegate: OpenAIProvider;
  private readonly model: string;
  private readonly client: OpenAI;

  constructor(options: OpenAICompatibleProviderOptions) {
    const apiKey = options.apiKey || "sk-no-key";
    this.client = new OpenAI({
      apiKey,
      baseURL: options.baseURL,
    });

    this.delegate = new OpenAIProvider({
      apiKey,
      model: options.model,
      baseURL: options.baseURL,
      maxTokens: options.maxTokens,
    });

    this.model = options.model;

    // Use explicit capabilities if provided; otherwise use conservative defaults.
    // The probe is async so we can't call it in the constructor.
    // Callers should use createOpenAICompatibleProvider() for auto-detection.
    this.capabilities = {
      ...CONSERVATIVE_CAPS,
      ...options.capabilities,
    };
  }

  async *chat(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    // Delegate to OpenAIProvider which handles the streaming protocol
    yield* this.delegate.chat(messages, tools, signal);
  }
}

// ---------------------------------------------------------------------------
// Async factory with capability probe
// ---------------------------------------------------------------------------

/**
 * Create an OpenAICompatibleProvider with auto-detected capabilities.
 * Falls back to conservative (text-only + streaming) if probe fails.
 */
export async function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions,
): Promise<OpenAICompatibleProvider> {
  // If explicit capabilities were provided, skip probe
  if (options.capabilities) {
    return new OpenAICompatibleProvider(options);
  }

  const apiKey = options.apiKey || "sk-no-key";
  const client = new OpenAI({
    apiKey,
    baseURL: options.baseURL,
  });

  const detected = await probeCapabilities(client, options.model);
  return new OpenAICompatibleProvider({
    ...options,
    capabilities: detected,
  });
}
