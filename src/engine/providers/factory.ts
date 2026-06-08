// Provider factory — creates Provider instances from resolved settings

import type { Provider } from "./base.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import {
  OpenAICompatibleProvider,
  createOpenAICompatibleProvider,
} from "./openai-compatible.js";
import type { ProviderName, ResolvedProvider } from "../../config/models.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface ProviderFactoryOptions {
  provider: ResolvedProvider;
  /** Model name to use. Falls back to provider.defaultModel. */
  model?: string;
  /** Max output tokens. Default: 4096. */
  maxTokens?: number;
}

/**
 * Create a Provider instance from resolved configuration.
 * Does NOT attempt to probe capabilities — callers should use
 * createProviderWithProbe() for OpenAI-compatible auto-detection.
 */
export function createProvider(options: ProviderFactoryOptions): Provider {
  const { provider, maxTokens } = options;
  const model = options.model ?? provider.defaultModel;

  switch (provider.name) {
    case "anthropic":
      return new AnthropicProvider({
        apiKey: provider.apiKey ?? "",
        model,
        baseURL: provider.baseURL,
        maxTokens,
      });

    case "openai":
      return new OpenAIProvider({
        apiKey: provider.apiKey ?? "",
        model,
        baseURL: provider.baseURL,
        maxTokens,
      });

    case "openai-compatible":
      return new OpenAICompatibleProvider({
        apiKey: provider.apiKey,
        model,
        baseURL: provider.baseURL ?? "http://localhost:11434/v1",
        maxTokens,
      });
  }
}

/**
 * Create a Provider with auto-probe for OpenAI-compatible providers.
 * For Anthropic and OpenAI, delegates directly to createProvider().
 */
export async function createProviderWithProbe(
  options: ProviderFactoryOptions,
): Promise<Provider> {
  if (options.provider.name === "openai-compatible") {
    const model = options.model ?? options.provider.defaultModel;
    return createOpenAICompatibleProvider({
      apiKey: options.provider.apiKey,
      model,
      baseURL: options.provider.baseURL ?? "http://localhost:11434/v1",
      maxTokens: options.maxTokens,
    });
  }

  return createProvider(options);
}
