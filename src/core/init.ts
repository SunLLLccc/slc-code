// Trust-phased initialization for slc-code
//
// Trust BEFORE: apply only safe env vars, set up error handling,
//               initialize certificates and HTTP Agent.
// Trust AFTER:  load user/project config, apply all SLC_ env vars.

import { ok, err, type Result } from "../utils/result.js";
import { SlcError } from "../utils/errors.js";
import { getSafeEnvVars, loadSettings, type ResolvedConfig } from "../config/settings.js";

// ---------------------------------------------------------------------------
// Init state
// ---------------------------------------------------------------------------

export interface SafeInfrastructure {
  /** Whether extra CA certificates were loaded. */
  certificatesInitialized: boolean;
  /** Whether the global HTTP Agent was configured. */
  httpAgentInitialized: boolean;
}

export interface InitState {
  /** Whether trust has been established. */
  trusted: boolean;
  /** Safe env vars captured before trust. */
  safeEnvVars: Record<string, string | undefined>;
  /** Safe infrastructure initialized before trust (certs, HTTP agent). */
  safeInfrastructure?: SafeInfrastructure;
  /** Fully resolved config (available only after trust). */
  config?: ResolvedConfig;
}

// ---------------------------------------------------------------------------
// Trust BEFORE — safe infrastructure
// ---------------------------------------------------------------------------

/**
 * Initialize extra CA certificates from the safe env var allowlist.
 *
 * Reads only `NODE_EXTRA_CA_CERTS` (a standard Node.js env var that is safe
 * to apply before trust). Does NOT read user/project config files.
 *
 * P1 placeholder: real certificate loading will be expanded when network
// calls are added in P2/P3. For now we record the initialization status.
 */
function initCertificates(safeEnvVars: Record<string, string | undefined>): boolean {
  // NODE_EXTRA_CA_CERTS is a standard Node.js env var handled automatically
  // by Node's TLS module. We record whether it was present in safe env vars.
  return safeEnvVars["NODE_EXTRA_CA_CERTS"] !== undefined;
}

/**
 * Initialize the global HTTP Agent for outgoing connections.
 *
 * Uses only safe env vars (no user/project config). This ensures TLS and
 * proxy settings from the OS environment are available before any network
 * call, without reading potentially untrusted config files.
 *
 * P1 placeholder: real Agent configuration (keepAlive, proxy, etc.) will
 * be expanded in P2/P3 when providers make actual HTTP calls.
 */
function initHttpAgent(): boolean {
  // The default Node.js http/https Agent is used automatically.
  // P2/P3 will configure keepAlive, proxy from safe env vars, etc.
  // For now we mark the initialization boundary as complete.
  return true;
}

// ---------------------------------------------------------------------------
// Trust BEFORE
// ---------------------------------------------------------------------------

let errorHandlersRegistered = false;

/**
 * Phase 1: Initialize only safe infrastructure.
 *
 * - Read only the safe env var allowlist (HOME, PATH, NODE_EXTRA_CA_CERTS, etc.)
 * - Initialize certificates from safe env vars only
 * - Initialize HTTP Agent from safe env vars only
 * - Set up process-level error handlers
 * - Do NOT read user/project config files
 * - Do NOT apply full SLC_ env vars
 */
export function initBeforeTrust(): InitState {
  // Capture only safe environment variables
  const safeEnvVars = getSafeEnvVars();

  // Initialize safe infrastructure (certs + HTTP agent) before any network call
  const certificatesInitialized = initCertificates(safeEnvVars);
  const httpAgentInitialized = initHttpAgent();

  // Set up global error handlers (once only)
  if (!errorHandlersRegistered) {
    errorHandlersRegistered = true;
    process.on("uncaughtException", (error: unknown) => {
      // eslint-disable-next-line no-console
      console.error("Uncaught exception:", error);
      process.exit(1);
    });

    process.on("unhandledRejection", (reason: unknown) => {
      // eslint-disable-next-line no-console
      console.error("Unhandled rejection:", reason);
      process.exit(1);
    });
  }

  return {
    trusted: false,
    safeEnvVars,
    safeInfrastructure: {
      certificatesInitialized,
      httpAgentInitialized,
    },
  };
}

// ---------------------------------------------------------------------------
// Trust AFTER
// ---------------------------------------------------------------------------

/**
 * Phase 2: After trust is established, load full configuration.
 *
 * - Load user + project settings files
 * - Apply SLC_ environment variable overrides
 * - Validate API key file permissions
 *
 * @param cwd The resolved working directory (from --cwd or process.cwd())
 */
export function initAfterTrust(
  state: InitState,
  cwd: string,
): Result<InitState> {
  const configResult = loadSettings(cwd);
  if (configResult.ok === false) {
    return err(
      new SlcError(`Failed to load settings: ${configResult.error.message}`),
    );
  }

  return ok({
    ...state,
    trusted: true,
    config: configResult.value,
  });
}
