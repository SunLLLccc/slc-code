// Sandbox configuration — defines what the sandbox allows and denies

import { join } from "node:path";

export interface SandboxConfig {
  /** Paths allowed for writing */
  allowWrite: string[];
  /** Paths denied for writing (overrides allowWrite) */
  denyWrite: string[];
  /** Whether network is allowed */
  allowNetwork: boolean;
}

/** Default paths that the control plane (settings, internal state) occupies. */
export const DEFAULT_CONTROL_PLANE_PATHS = {
  /** SLC settings directory — always denied in sandbox. */
  settingsDir: ".slc",
} as const;

/**
 * Build a conservative sandbox config for a given project.
 * - Writing is only allowed inside projectRoot.
 * - Settings and internal .slc directories are explicitly denied.
 * - Network is denied by default.
 */
export function buildSandboxConfig(options: {
  projectRoot: string;
  settingsPath: string;
}): SandboxConfig {
  const { projectRoot, settingsPath } = options;

  return {
    allowWrite: [projectRoot],
    denyWrite: [settingsPath, join(projectRoot, ".slc")],
    allowNetwork: false,
  };
}
