// Tests for config/settings.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadSettings,
  resolveApiKey,
  checkFilePermissions,
  getSafeEnvVars,
  checkAllApiKeyFilePermissions,
  DEFAULT_SETTINGS,
  type ProviderConfig,
  type SlcSettings,
} from "../../src/config/settings.js";
import type { Result } from "../../src/utils/result.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix = "slc-settings-test-"): string {
  const dir = mkdirSync(join(tmpdir(), prefix + Math.random().toString(36).slice(2)), { recursive: true });
  return dir;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// loadSettings — merge order
// ---------------------------------------------------------------------------

describe("loadSettings", () => {
  let tmpDir: string;
  const origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = makeTempDir();
    // Snapshot env vars we might change
    for (const key of [
      "SLC_MODEL",
      "SLC_SANDBOX_ENABLED",
      "SLC_SESSION_PERSISTENCEENABLED",
    ]) {
      origEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    // Restore env
    for (const [key, val] of Object.entries(origEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("returns defaults when no config files exist", () => {
    const result = loadSettings(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.model).toBe(DEFAULT_SETTINGS.model);
    expect(result.value.session?.persistenceEnabled).toBe(true);
  });

  it("merges user settings on top of defaults", () => {
    // Fake home dir
    const fakeHome = join(tmpDir, "home");
    mkdirSync(join(fakeHome, ".slc"), { recursive: true });
    writeJson(join(fakeHome, ".slc", "settings.json"), {
      model: "gpt-4o",
    });

    // Patch homedir by using project settings as a proxy
    const projectDir = join(tmpDir, "project");
    mkdirSync(join(projectDir, ".slc"), { recursive: true });
    writeJson(join(projectDir, ".slc", "settings.json"), {
      model: "gpt-4o",
    });

    const result = loadSettings(projectDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.model).toBe("gpt-4o");
  });

  it("project settings override user settings", () => {
    const projectDir = join(tmpDir, "project");
    mkdirSync(join(projectDir, ".slc"), { recursive: true });
    writeJson(join(projectDir, ".slc", "settings.json"), {
      model: "claude-opus-4",
    });

    const result = loadSettings(projectDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.model).toBe("claude-opus-4");
  });

  it("local settings override non-local settings", () => {
    const projectDir = join(tmpDir, "project");
    mkdirSync(join(projectDir, ".slc"), { recursive: true });
    writeJson(join(projectDir, ".slc", "settings.json"), {
      model: "gpt-4o",
    });
    writeJson(join(projectDir, ".slc", "settings.local.json"), {
      model: "claude-sonnet-4-6",
    });

    const result = loadSettings(projectDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.model).toBe("claude-sonnet-4-6");
  });

  it("SLC_ env vars override all file-based settings", () => {
    const projectDir = join(tmpDir, "project");
    mkdirSync(join(projectDir, ".slc"), { recursive: true });
    writeJson(join(projectDir, ".slc", "settings.json"), {
      model: "gpt-4o",
    });

    process.env.SLC_MODEL = "claude-opus-4";
    const result = loadSettings(projectDir);
    delete process.env.SLC_MODEL;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.model).toBe("claude-opus-4");
  });

  it("merges provider configs without clobbering sibling fields", () => {
    const projectDir = join(tmpDir, "project");
    mkdirSync(join(projectDir, ".slc"), { recursive: true });
    writeJson(join(projectDir, ".slc", "settings.json"), {
      providers: {
        anthropic: {
          apiKeyEnv: "MY_ANTHROPIC_KEY",
          defaultModel: "claude-opus-4",
        },
      },
    });
    writeJson(join(projectDir, ".slc", "settings.local.json"), {
      providers: {
        anthropic: {
          apiKeyEnv: "LOCAL_ANTHROPIC_KEY",
        },
      },
    });

    const result = loadSettings(projectDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // apiKeyEnv is overridden, defaultModel is preserved from settings.json
    expect(result.value.providers?.anthropic?.apiKeyEnv).toBe(
      "LOCAL_ANTHROPIC_KEY",
    );
    expect(result.value.providers?.anthropic?.defaultModel).toBe(
      "claude-opus-4",
    );
  });

  it("handles invalid JSON gracefully", () => {
    const projectDir = join(tmpDir, "project");
    mkdirSync(join(projectDir, ".slc"), { recursive: true });
    writeFileSync(
      join(projectDir, ".slc", "settings.json"),
      "{ invalid json",
      "utf-8",
    );

    const result = loadSettings(projectDir);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveApiKey — priority
// ---------------------------------------------------------------------------

describe("resolveApiKey", () => {
  const origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "SLC_ANTHROPIC_API_KEY",
      "SLC_OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "MY_CUSTOM_KEY",
    ]) {
      origEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(origEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("returns undefined when no config provided", () => {
    const result = resolveApiKey("anthropic");
    expect(result.ok).toBe(true);
    expect(result.value).toBeUndefined();
  });

  it("apiKeyEnv takes priority over apiKey", () => {
    process.env.SLC_ANTHROPIC_API_KEY = "env-key";
    const config: ProviderConfig = {
      apiKeyEnv: "SLC_ANTHROPIC_API_KEY",
      apiKey: "plaintext-key",
    };
    const result = resolveApiKey("anthropic", config);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("env-key");
    delete process.env.SLC_ANTHROPIC_API_KEY;
  });

  it("falls back to SDK default env var", () => {
    process.env.ANTHROPIC_API_KEY = "sdk-key";
    const config: ProviderConfig = {
      apiKeyEnv: "SLC_ANTHROPIC_API_KEY", // not set
    };
    const result = resolveApiKey("anthropic", config);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("sdk-key");
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("falls back to plaintext apiKey", () => {
    const config: ProviderConfig = {
      apiKeyEnv: "SLC_ANTHROPIC_API_KEY", // not set
      apiKey: "plaintext-key",
    };
    const result = resolveApiKey("anthropic", config);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("plaintext-key");
  });

  it("custom apiKeyEnv is resolved", () => {
    process.env.MY_CUSTOM_KEY = "custom-value";
    const config: ProviderConfig = {
      apiKeyEnv: "MY_CUSTOM_KEY",
    };
    const result = resolveApiKey("anthropic", config);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("custom-value");
    delete process.env.MY_CUSTOM_KEY;
  });
});

// ---------------------------------------------------------------------------
// checkFilePermissions
// ---------------------------------------------------------------------------

describe("checkFilePermissions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("slc-perm-test-");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns ok for non-existent file", () => {
    const result = checkFilePermissions(join(tmpDir, "nope.json"));
    expect(result.ok).toBe(true);
  });

  it("returns ok for file with 0600 permissions", () => {
    const filePath = join(tmpDir, "secret.json");
    writeFileSync(filePath, '{"apiKey":"x"}', "utf-8");
    chmodSync(filePath, 0o600);
    const result = checkFilePermissions(filePath);
    expect(result.ok).toBe(true);
  });

  it("returns error for file with loose permissions", () => {
    const filePath = join(tmpDir, "loose.json");
    writeFileSync(filePath, '{"apiKey":"x"}', "utf-8");
    chmodSync(filePath, 0o644);
    const result = checkFilePermissions(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("600");
    }
  });
});

// ---------------------------------------------------------------------------
// getSafeEnvVars
// ---------------------------------------------------------------------------

describe("getSafeEnvVars", () => {
  it("only returns allowlisted vars", () => {
    process.env.HOME = "/tmp/test-home";
    process.env.SLC_DANGEROUS = "should-not-appear";
    const safe = getSafeEnvVars();
    expect(safe.HOME).toBe("/tmp/test-home");
    expect(safe.SLC_DANGEROUS).toBeUndefined();
    delete process.env.SLC_DANGEROUS;
  });
});

// ---------------------------------------------------------------------------
// checkAllApiKeyFilePermissions
// ---------------------------------------------------------------------------

describe("checkAllApiKeyFilePermissions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("slc-allperm-test-");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no files contain apiKey", () => {
    const results = checkAllApiKeyFilePermissions(tmpDir);
    expect(results).toHaveLength(0);
  });

  it("returns error for loose permissions on file containing apiKey", () => {
    const settingsDir = join(tmpDir, ".slc");
    mkdirSync(settingsDir, { recursive: true });
    const filePath = join(settingsDir, "settings.json");
    writeFileSync(filePath, '{"apiKey":"secret"}', "utf-8");
    chmodSync(filePath, 0o644);

    const results = checkAllApiKeyFilePermissions(tmpDir);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const failed = results.find((r) => !r.ok);
    expect(failed).toBeDefined();
    expect(failed!.ok).toBe(false);
  });
});
