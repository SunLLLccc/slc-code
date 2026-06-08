// Tests for sandbox configuration

import { describe, it, expect } from "vitest";
import { buildSandboxConfig, DEFAULT_CONTROL_PLANE_PATHS } from "../../src/sandbox/config.js";

// ---------------------------------------------------------------------------
// buildSandboxConfig
// ---------------------------------------------------------------------------

describe("buildSandboxConfig", () => {
  it("sets project root as only allowWrite path", () => {
    const config = buildSandboxConfig({
      projectRoot: "/my/project",
      settingsPath: "/my/project/.slc",
    });
    expect(config.allowWrite).toEqual(["/my/project"]);
  });

  it("includes settings path and .slc in denyWrite", () => {
    const config = buildSandboxConfig({
      projectRoot: "/my/project",
      settingsPath: "/my/project/.slc",
    });
    expect(config.denyWrite).toContain("/my/project/.slc");
    // denyWrite[0] is settingsPath, denyWrite[1] is join(projectRoot, ".slc")
    // Both point to .slc — this is by design for defense-in-depth
    expect(config.denyWrite).toHaveLength(2);
  });

  it("denies network by default", () => {
    const config = buildSandboxConfig({
      projectRoot: "/project",
      settingsPath: "/project/.slc",
    });
    expect(config.allowNetwork).toBe(false);
  });

  it("denyWrite has exactly 2 entries", () => {
    const config = buildSandboxConfig({
      projectRoot: "/project",
      settingsPath: "/project/.slc",
    });
    expect(config.denyWrite).toHaveLength(2);
  });

  it("BashTool sandbox path uses .slc as settings path", () => {
    // Simulate what BashTool does: resolveToolPath(".slc", cwd)
    const cwd = "/workspace/project";
    const settingsPath = cwd + "/.slc";
    const config = buildSandboxConfig({
      projectRoot: cwd,
      settingsPath,
    });
    expect(config.denyWrite[0]).toBe("/workspace/project/.slc");
    expect(config.denyWrite[1]).toBe("/workspace/project/.slc");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CONTROL_PLANE_PATHS
// ---------------------------------------------------------------------------

describe("DEFAULT_CONTROL_PLANE_PATHS", () => {
  it("defines settings directory as .slc", () => {
    expect(DEFAULT_CONTROL_PLANE_PATHS.settingsDir).toBe(".slc");
  });
});
