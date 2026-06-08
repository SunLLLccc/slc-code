// Configuration types, loading, and merge logic for slc-code

import { readFileSync, statSync } from "node:fs";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ok, err, type Result } from "../utils/result.js";
import { SlcError } from "../utils/errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  apiKeyEnv?: string;
  apiKey?: string;
  defaultModel?: string;
  baseURL?: string;
}

export interface PermissionSettings {
  allow?: string[];
  deny?: string[];
}

export interface SandboxSettings {
  enabled?: boolean;
  filesystem?: {
    allowWrite?: string[];
    denyWrite?: string[];
  };
}

export interface MemorySettings {
  autoMemoryEnabled?: boolean;
}

export interface SessionSettings {
  persistenceEnabled?: boolean;
  cleanupPeriodDays?: number;
}

export interface McpServerSetting {
  transport: "stdio" | "sse" | "http" | "ws";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface SlcSettings {
  model?: string;
  providers?: {
    anthropic?: ProviderConfig;
    openai?: ProviderConfig;
    "openai-compatible"?: ProviderConfig;
  };
  permissions?: PermissionSettings;
  sandbox?: SandboxSettings;
  memory?: MemorySettings;
  session?: SessionSettings;
  mcpServers?: Record<string, McpServerSetting>;
}

/** Resolved runtime config after merging all layers. */
export interface ResolvedConfig extends SlcSettings {
  /** Whether --bare mode is active (disables all persistence). */
  bare?: boolean;
  /** Resolved working directory. */
  cwd?: string;
  /** Permission mode override from CLI. */
  permissionMode?: string;
  /** Model override from CLI --model flag. */
  modelOverride?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: Readonly<SlcSettings> = {
  model: "claude-sonnet-4-6",
  providers: {
    anthropic: {
      apiKeyEnv: "SLC_ANTHROPIC_API_KEY",
      defaultModel: "claude-sonnet-4-6",
    },
    openai: {
      apiKeyEnv: "SLC_OPENAI_API_KEY",
      defaultModel: "gpt-4o",
      baseURL: "https://api.openai.com/v1",
    },
    "openai-compatible": {
      apiKeyEnv: "SLC_LOCAL_API_KEY",
      defaultModel: "local-model",
      baseURL: "http://localhost:11434/v1",
    },
  },
  permissions: {
    allow: [],
    deny: [],
  },
  sandbox: {
    enabled: true,
  },
  memory: {
    autoMemoryEnabled: true,
  },
  session: {
    persistenceEnabled: true,
    cleanupPeriodDays: 30,
  },
};

// ---------------------------------------------------------------------------
// Safe env var allowlist (applied before trust)
// ---------------------------------------------------------------------------

/** Environment variables safe to read before establishing trust. */
const SAFE_ENV_VARS: ReadonlySet<string> = new Set([
  "HOME",
  "PATH",
  "NODE_ENV",
  "NODE_EXTRA_CA_CERTS",
  "TERM",
  "LANG",
  "LC_ALL",
  "SLC_BARE",
]);

// ---------------------------------------------------------------------------
// Config file helpers
// ---------------------------------------------------------------------------

function readJsonFile(filePath: string): Result<Record<string, unknown>> {
  if (!existsSync(filePath)) {
    return ok({});
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    return ok(JSON.parse(content) as Record<string, unknown>);
  } catch (e) {
    return err(
      new SlcError(
        `Failed to read config file ${filePath}: ${(e as Error).message}`,
      ),
    );
  }
}

/**
 * Check that a file containing sensitive data has restrictive permissions.
 * Returns ok(true) if permissions are safe, or err with a description.
 */
export function checkFilePermissions(filePath: string): Result<true> {
  try {
    const stat = statSync(filePath);
    const mode = stat.mode & 0o777;
    if (mode !== 0o600) {
      return err(
        new SlcError(
          `Security: ${filePath} has permissions ${mode.toString(8).padStart(3, "0")}, expected 600. ` +
            `Run: chmod 600 "${filePath}"`,
        ),
      );
    }
    return ok(true);
  } catch {
    // File doesn't exist — nothing to check.
    return ok(true);
  }
}

// ---------------------------------------------------------------------------
// Deep merge
// ---------------------------------------------------------------------------

/** Keys whose values are plain objects that should be deep-merged. */
const DEEP_MERGE_KEYS = [
  "permissions",
  "sandbox",
  "memory",
  "session",
] as const;

/**
 * Merge settings with deep-merge for known nested object keys.
 * Values from `override` win. Arrays are replaced, not concatenated.
 */
function mergeSettings(
  base: SlcSettings,
  override: Partial<SlcSettings>,
): SlcSettings {
  const result = { ...base, ...override };
  // Deep-merge nested objects so partial overrides don't clobber sibling keys
  for (const key of DEEP_MERGE_KEYS) {
    const b = base[key] as Record<string, unknown> | undefined;
    const o = override[key] as Record<string, unknown> | undefined;
    if (b && o && typeof b === "object" && typeof o === "object") {
      result[key] = { ...b, ...o } as never;
    }
  }
  return result;
}

/**
 * Deep-merge provider configs so that e.g. only `apiKeyEnv` from a local
 * override doesn't clobber the `defaultModel` from user settings.
 */
function mergeProviders(
  base: SlcSettings["providers"],
  override: SlcSettings["providers"],
): SlcSettings["providers"] {
  if (!base && !override) return undefined;
  if (!override) return base;
  if (!base) return override;

  const result: NonNullable<SlcSettings["providers"]> = {};
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(override),
  ]) as Set<keyof typeof result>;

  for (const key of keys) {
    const b = base[key];
    const o = override[key];
    if (b && o) {
      result[key] = { ...b, ...o };
    } else {
      result[key] = o ?? b;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// SLC_ environment variable override
// ---------------------------------------------------------------------------

/** Known env var mappings (SLC_ prefix -> dot-path in settings). */
const ENV_VAR_MAP: Record<string, string> = {
  SLC_MODEL: "model",
  SLC_PERMISSION_MODE: "permissionMode",
  SLC_SANDBOX_ENABLED: "sandbox.enabled",
  SLC_MEMORY_AUTOMEMORYENABLED: "memory.autoMemoryEnabled",
  SLC_SESSION_PERSISTENCEENABLED: "session.persistenceEnabled",
  SLC_SESSION_CLEANUPPERIODDAYS: "session.cleanupPeriodDays",
};

/**
 * Apply SLC_ environment variable overrides to a config object.
 * Only processes variables in ENV_VAR_MAP.
 */
function applyEnvOverrides(config: ResolvedConfig): ResolvedConfig {
  const result = { ...config };
  for (const [envKey, path] of Object.entries(ENV_VAR_MAP)) {
    const value = process.env[envKey];
    if (value === undefined) continue;

    const parts = path.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let target: any = result;
    for (let i = 0; i < parts.length - 1; i++) {
      target[parts[i]] ??= {};
      target = target[parts[i]];
    }
    const lastKey = parts[parts.length - 1];
    // Coerce boolean/number strings
    if (value === "true") {
      target[lastKey] = true;
    } else if (value === "false") {
      target[lastKey] = false;
    } else if (/^\d+$/.test(value)) {
      target[lastKey] = Number(value);
    } else {
      target[lastKey] = value;
    }
  }
  return result;
}

/**
 * Return only the safe environment variables from the allowlist.
 * Used during the trust-before phase.
 */
export function getSafeEnvVars(): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const key of SAFE_ENV_VARS) {
    if (process.env[key] !== undefined) {
      result[key] = process.env[key];
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// API Key resolution
// ---------------------------------------------------------------------------

/** SDK default environment variable names for each provider. */
const SDK_DEFAULT_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * Resolve the API key for a given provider.
 *
 * Priority: apiKeyEnv env var -> SDK default env var -> plaintext apiKey fallback.
 */
export function resolveApiKey(
  providerName: string,
  providerConfig?: ProviderConfig,
): Result<string | undefined> {
  if (!providerConfig) return ok(undefined);

  // 1. apiKeyEnv — look up the env var by the name configured
  if (providerConfig.apiKeyEnv) {
    const key = process.env[providerConfig.apiKeyEnv];
    if (key) return ok(key);
  }

  // 2. SDK default env var
  const sdkDefault = SDK_DEFAULT_ENV[providerName];
  if (sdkDefault) {
    const key = process.env[sdkDefault];
    if (key) return ok(key);
  }

  // 3. Plaintext apiKey fallback
  if (providerConfig.apiKey) {
    return ok(providerConfig.apiKey);
  }

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and merge settings from all layers.
 *
 * Merge order (low → high priority):
 *   1. Built-in defaults
 *   2. User settings (~/.slc/settings.json)
 *   3. Project settings (<cwd>/.slc/settings.json)
 *   4. Local overrides (~/.slc/settings.local.json then <cwd>/.slc/settings.local.json)
 *   5. SLC_ environment variables
 */
export function loadSettings(cwd: string): Result<ResolvedConfig> {
  const userDir = homedir();
  const userSettingsPath = join(userDir, ".slc", "settings.json");
  const userLocalPath = join(userDir, ".slc", "settings.local.json");
  const projectSettingsPath = join(cwd, ".slc", "settings.json");
  const projectLocalPath = join(cwd, ".slc", "settings.local.json");

  // 1. Defaults
  let config: SlcSettings = { ...DEFAULT_SETTINGS };

  // 2. User settings
  const userResult = readJsonFile(userSettingsPath);
  if (userResult.ok === false) return userResult;
  if (Object.keys(userResult.value).length > 0) {
    const providers = mergeProviders(
      config.providers,
      (userResult.value as Partial<SlcSettings>).providers,
    );
    config = mergeSettings(config, userResult.value as Partial<SlcSettings>);
    config.providers = providers;
  }

  // 3. Project settings
  const projectResult = readJsonFile(projectSettingsPath);
  if (projectResult.ok === false) return projectResult;
  if (Object.keys(projectResult.value).length > 0) {
    const providers = mergeProviders(
      config.providers,
      (projectResult.value as Partial<SlcSettings>).providers,
    );
    config = mergeSettings(config, projectResult.value as Partial<SlcSettings>);
    config.providers = providers;
  }

  // 4a. User local overrides
  const userLocalResult = readJsonFile(userLocalPath);
  if (userLocalResult.ok === false) return userLocalResult;
  if (Object.keys(userLocalResult.value).length > 0) {
    const providers = mergeProviders(
      config.providers,
      (userLocalResult.value as Partial<SlcSettings>).providers,
    );
    config = mergeSettings(
      config,
      userLocalResult.value as Partial<SlcSettings>,
    );
    config.providers = providers;
  }

  // 4b. Project local overrides
  const projectLocalResult = readJsonFile(projectLocalPath);
  if (projectLocalResult.ok === false) return projectLocalResult;
  if (Object.keys(projectLocalResult.value).length > 0) {
    const providers = mergeProviders(
      config.providers,
      (projectLocalResult.value as Partial<SlcSettings>).providers,
    );
    config = mergeSettings(
      config,
      projectLocalResult.value as Partial<SlcSettings>,
    );
    config.providers = providers;
  }

  // 5. Env var overrides
  let resolved: ResolvedConfig = { ...config };
  resolved = applyEnvOverrides(resolved);

  return ok(resolved);
}

/**
 * Check file permissions for all settings files that contain plaintext apiKey.
 * Returns all errors found.
 */
export function checkAllApiKeyFilePermissions(
  cwd: string,
): Result<true>[] {
  const userDir = homedir();
  const paths = [
    join(userDir, ".slc", "settings.json"),
    join(userDir, ".slc", "settings.local.json"),
    join(cwd, ".slc", "settings.json"),
    join(cwd, ".slc", "settings.local.json"),
  ];

  return paths
    .filter((p) => {
      if (!existsSync(p)) return false;
      try {
        const content = readFileSync(p, "utf-8");
        return content.includes('"apiKey"');
      } catch {
        return false;
      }
    })
    .map((p) => checkFilePermissions(p));
}
