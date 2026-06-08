// Provider types and selection logic for slc-code

import { ok, err, type Result } from "../utils/result.js";
import { SlcError } from "../utils/errors.js";
import {
  type ProviderConfig,
  type ResolvedConfig,
  resolveApiKey,
} from "./settings.js";

// ---------------------------------------------------------------------------
// Provider types
// ---------------------------------------------------------------------------

export type ProviderName = "anthropic" | "openai" | "openai-compatible";

export interface ResolvedProvider {
  /** Which provider backend to use. */
  name: ProviderName;
  /** Resolved API key (may be undefined if none configured). */
  apiKey: string | undefined;
  /** Default model for this provider. */
  defaultModel: string;
  /** Base URL (only meaningful for openai-compatible). */
  baseURL: string | undefined;
  /** The apiKeyEnv var name configured (if any). */
  apiKeyEnv: string | undefined;
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

/**
 * Determine which provider to use based on the resolved model name.
 *
 * Model name heuristics:
 *   - Starts with "claude-" → anthropic
 *   - Starts with "gpt-" or "o1-" or "o3-" → openai
 *   - Anything else → openai-compatible
 */
export function inferProviderFromModel(model: string): ProviderName {
  if (model.startsWith("claude-")) return "anthropic";
  if (
    model.startsWith("gpt-") ||
    model.startsWith("o1-") ||
    model.startsWith("o3-")
  ) {
    return "openai";
  }
  return "openai-compatible";
}

/**
 * Select and resolve a provider based on the merged configuration.
 *
 * Resolution logic:
 *  1. If settings.model is set, infer the provider from the model name.
 *  2. Fall back to the first provider that has an API key available.
 *  3. Fall back to "anthropic" as the default.
 *
 * This does NOT instantiate any SDK client — P2/P3 handles that.
 */
export function selectProvider(
  config: ResolvedConfig,
): Result<ResolvedProvider> {
  // Use the final resolved model (including --model override) to infer provider
  const model = config.modelOverride ?? config.model ?? "claude-sonnet-4-6";
  const providerName = inferProviderFromModel(model);
  const providerConfig = config.providers?.[providerName];

  const apiKeyResult = resolveApiKey(providerName, providerConfig);
  if (apiKeyResult.ok === false) return apiKeyResult;

  // Validate: if plaintext apiKey is set, warn (permission check happens
  // separately during setup). We don't block here.

  return ok({
    name: providerName,
    apiKey: apiKeyResult.value,
    defaultModel: providerConfig?.defaultModel ?? model,
    baseURL: providerConfig?.baseURL,
    apiKeyEnv: providerConfig?.apiKeyEnv,
  });
}

/**
 * Build the resolved model string:
 *  1. CLI --model flag override (stored in config.modelOverride)
 *  2. config.model (from settings)
 *  3. Provider default model
 */
export function resolveModel(
  config: ResolvedConfig,
  provider: ResolvedProvider,
): string {
  return config.modelOverride ?? config.model ?? provider.defaultModel;
}
