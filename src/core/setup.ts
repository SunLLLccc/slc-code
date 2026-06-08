// Full setup orchestration for slc-code
//
// Orchestrates the init lifecycle: trust-before → establish trust → trust-after
// → resolve provider. Does NOT start the REPL or call any model API.

import { ok, err, type Result } from "../utils/result.js";
import { SlcError } from "../utils/errors.js";
import { checkAllApiKeyFilePermissions, type ResolvedConfig } from "../config/settings.js";
import { selectProvider, type ResolvedProvider } from "../config/models.js";
import { initBeforeTrust, initAfterTrust, type InitState } from "./init.js";

// ---------------------------------------------------------------------------
// Setup result
// ---------------------------------------------------------------------------

export interface SetupResult {
  state: InitState;
  config: ResolvedConfig;
  provider: ResolvedProvider;
}

// ---------------------------------------------------------------------------
// Setup API
// ---------------------------------------------------------------------------

/**
 * Run the complete initialization lifecycle.
 *
 * 1. Trust-before: safe env vars, error handlers
 * 2. Trust-after: load settings, validate
 * 3. Select provider based on resolved config
 *
 * @param cwd Working directory (from --cwd or process.cwd())
 * @param bare Whether --bare mode is active
 * @param modelOverride Model override from --model flag
 * @param permissionMode Permission mode from --permission-mode flag
 */
export function setup(
  cwd: string,
  options?: {
    bare?: boolean;
    modelOverride?: string;
    permissionMode?: string;
  },
): Result<SetupResult> {
  // Phase 1: trust-before
  const preState = initBeforeTrust();

  // Phase 2: trust-after — load full config
  const postStateResult = initAfterTrust(preState, cwd);
  if (postStateResult.ok === false) return postStateResult;

  const postState = postStateResult.value;
  const config = postState.config!;

  // Apply CLI flags on top of resolved config
  const finalConfig: ResolvedConfig = {
    ...config,
    bare: options?.bare ?? false,
    cwd,
    modelOverride: options?.modelOverride,
    permissionMode: options?.permissionMode,
  };

  // If bare mode, disable persistence flags
  if (finalConfig.bare) {
    finalConfig.session = {
      ...finalConfig.session,
      persistenceEnabled: false,
    };
    finalConfig.memory = {
      ...finalConfig.memory,
      autoMemoryEnabled: false,
    };
  }

  // Validate API key file permissions for files containing plaintext apiKey
  const permissionResults = checkAllApiKeyFilePermissions(cwd);
  for (const pr of permissionResults) {
    if (pr.ok === false) {
      return err(pr.error);
    }
  }

  // Select provider
  const providerResult = selectProvider(finalConfig);
  if (providerResult.ok === false) return providerResult;

  return ok({
    state: postState,
    config: finalConfig,
    provider: providerResult.value,
  });
}
