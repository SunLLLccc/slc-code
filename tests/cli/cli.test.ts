// Tests for CLI entry point, init lifecycle, and provider selection

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main, EXIT_CODE, createProgram } from "../../src/entrypoints/cli.js";
import type { CliDependencies } from "../../src/entrypoints/cli.js";
import { initBeforeTrust, initAfterTrust } from "../../src/core/init.js";
import { setup } from "../../src/core/setup.js";
import {
  inferProviderFromModel,
  selectProvider,
  resolveModel,
} from "../../src/config/models.js";
import type { ResolvedConfig } from "../../src/config/settings.js";
import { MockProvider } from "../../src/engine/providers/base.js";
import type { Provider } from "../../src/engine/providers/base.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix = "slc-cli-test-"): string {
  return mkdirSync(
    join(tmpdir(), prefix + Math.random().toString(36).slice(2)),
    { recursive: true },
  );
}

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

describe("CLI --version", () => {
  it("prints version via fast-path", async () => {
    let output = "";
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") output += chunk;
      return true;
    };
    const code = await main(["node", "slc", "--version"]);
    process.stdout.write = origWrite;
    expect(code).toBe(EXIT_CODE.SUCCESS);
    expect(output).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it("prints version with -v", async () => {
    let output = "";
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") output += chunk;
      return true;
    };
    const code = await main(["node", "slc", "-v"]);
    process.stdout.write = origWrite;
    expect(code).toBe(EXIT_CODE.SUCCESS);
    expect(output).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});

describe("CLI --help", () => {
  it("exits with success on --help", async () => {
    // Commander writes help to stdout and throws an error with exitCode=0
    const code = await main(["node", "slc", "--help"]);
    expect(code).toBe(EXIT_CODE.SUCCESS);
  });
});

describe("CLI program options", () => {
  it("defines --print option", () => {
    const program = createProgram();
    const opts = program.options;
    const printOpt = opts.find((o) => o.long === "--print");
    expect(printOpt).toBeDefined();
    expect(printOpt?.short).toBe("-p");
  });

  it("defines --stdin option", () => {
    const program = createProgram();
    const opts = program.options;
    const stdinOpt = opts.find((o) => o.long === "--stdin");
    expect(stdinOpt).toBeDefined();
  });

  it("defines --model option", () => {
    const program = createProgram();
    const opts = program.options;
    const modelOpt = opts.find((o) => o.long === "--model");
    expect(modelOpt).toBeDefined();
    expect(modelOpt?.short).toBe("-m");
  });

  it("defines --permission-mode option", () => {
    const program = createProgram();
    const opts = program.options;
    const permOpt = opts.find((o) => o.long === "--permission-mode");
    expect(permOpt).toBeDefined();
  });

  it("defines --cwd option", () => {
    const program = createProgram();
    const opts = program.options;
    const cwdOpt = opts.find((o) => o.long === "--cwd");
    expect(cwdOpt).toBeDefined();
  });

  it("defines --bare option", () => {
    const program = createProgram();
    const opts = program.options;
    const bareOpt = opts.find((o) => o.long === "--bare");
    expect(bareOpt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------

describe("Exit codes", () => {
  it("exports correct exit code values", () => {
    expect(EXIT_CODE.SUCCESS).toBe(0);
    expect(EXIT_CODE.ERROR).toBe(1);
    expect(EXIT_CODE.PERMISSION_DENIED).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Trust lifecycle
// ---------------------------------------------------------------------------

describe("Trust-before initialization", () => {
  it("does not read user/project config", () => {
    const state = initBeforeTrust();
    expect(state.trusted).toBe(false);
    expect(state.config).toBeUndefined();
  });

  it("only returns safe env vars", () => {
    process.env.HOME = "/tmp/test";
    process.env.SLC_DANGEROUS_VAR = "should-not-appear";
    const state = initBeforeTrust();
    expect(state.safeEnvVars.HOME).toBe("/tmp/test");
    expect(state.safeEnvVars.SLC_DANGEROUS_VAR).toBeUndefined();
    delete process.env.SLC_DANGEROUS_VAR;
  });

  it("initializes safe infrastructure (certs + HTTP agent)", () => {
    const state = initBeforeTrust();
    expect(state.safeInfrastructure).toBeDefined();
    expect(state.safeInfrastructure?.httpAgentInitialized).toBe(true);
  });

  it("reports certificates not initialized when NODE_EXTRA_CA_CERTS is absent", () => {
    const orig = process.env.NODE_EXTRA_CA_CERTS;
    delete process.env.NODE_EXTRA_CA_CERTS;
    const state = initBeforeTrust();
    expect(state.safeInfrastructure?.certificatesInitialized).toBe(false);
    if (orig) process.env.NODE_EXTRA_CA_CERTS = orig;
  });

  it("reports certificates initialized when NODE_EXTRA_CA_CERTS is present", () => {
    process.env.NODE_EXTRA_CA_CERTS = "/tmp/fake-ca.pem";
    const state = initBeforeTrust();
    expect(state.safeInfrastructure?.certificatesInitialized).toBe(true);
    delete process.env.NODE_EXTRA_CA_CERTS;
  });
});

describe("Trust-after initialization", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads config after trust is established", () => {
    const preState = initBeforeTrust();
    const result = initAfterTrust(preState, tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trusted).toBe(true);
    expect(result.value.config).toBeDefined();
    expect(result.value.config?.model).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// --bare mode
// ---------------------------------------------------------------------------

describe("--bare mode", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sets bare flag and disables persistence", () => {
    const result = setup(tmpDir, { bare: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.config.bare).toBe(true);
    expect(result.value.config.session?.persistenceEnabled).toBe(false);
    expect(result.value.config.memory?.autoMemoryEnabled).toBe(false);
  });

  it("does not disable persistence when bare is false", () => {
    const result = setup(tmpDir, { bare: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.config.bare).toBe(false);
    expect(result.value.config.session?.persistenceEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

describe("inferProviderFromModel", () => {
  it("infers anthropic from claude-* models", () => {
    expect(inferProviderFromModel("claude-sonnet-4-6")).toBe("anthropic");
    expect(inferProviderFromModel("claude-opus-4")).toBe("anthropic");
    expect(inferProviderFromModel("claude-3-5-sonnet")).toBe("anthropic");
  });

  it("infers openai from gpt-* models", () => {
    expect(inferProviderFromModel("gpt-4o")).toBe("openai");
    expect(inferProviderFromModel("gpt-3.5-turbo")).toBe("openai");
  });

  it("infers openai from o1-* and o3-* models", () => {
    expect(inferProviderFromModel("o1-preview")).toBe("openai");
    expect(inferProviderFromModel("o3-mini")).toBe("openai");
  });

  it("infers openai-compatible for unknown models", () => {
    expect(inferProviderFromModel("llama-3.1")).toBe("openai-compatible");
    expect(inferProviderFromModel("qwen-2.5")).toBe("openai-compatible");
  });
});

describe("selectProvider", () => {
  const origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "SLC_ANTHROPIC_API_KEY",
      "SLC_OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
    ]) {
      origEnv[key] = process.env[key];
      delete process.env[key];
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

  it("selects anthropic provider for claude-* model", () => {
    const config: ResolvedConfig = { model: "claude-sonnet-4-6" };
    const result = selectProvider(config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("anthropic");
    expect(result.value.defaultModel).toBe("claude-sonnet-4-6");
  });

  it("selects openai provider for gpt-* model", () => {
    const config: ResolvedConfig = { model: "gpt-4o" };
    const result = selectProvider(config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("openai");
  });

  it("selects openai-compatible provider for unknown models", () => {
    const config: ResolvedConfig = { model: "llama-3.1" };
    const result = selectProvider(config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("openai-compatible");
  });
});

describe("resolveModel", () => {
  it("uses modelOverride when set", () => {
    const config: ResolvedConfig = {
      model: "claude-sonnet-4-6",
      modelOverride: "gpt-4o",
    };
    const provider = {
      name: "anthropic" as const,
      apiKey: undefined,
      defaultModel: "claude-sonnet-4-6",
      baseURL: undefined,
      apiKeyEnv: undefined,
    };
    expect(resolveModel(config, provider)).toBe("gpt-4o");
  });

  it("falls back to config.model", () => {
    const config: ResolvedConfig = { model: "claude-sonnet-4-6" };
    const provider = {
      name: "anthropic" as const,
      apiKey: undefined,
      defaultModel: "claude-sonnet-4-6",
      baseURL: undefined,
      apiKeyEnv: undefined,
    };
    expect(resolveModel(config, provider)).toBe("claude-sonnet-4-6");
  });

  it("falls back to provider defaultModel", () => {
    const config: ResolvedConfig = {};
    const provider = {
      name: "openai" as const,
      apiKey: undefined,
      defaultModel: "gpt-4o",
      baseURL: undefined,
      apiKeyEnv: undefined,
    };
    expect(resolveModel(config, provider)).toBe("gpt-4o");
  });
});

// ---------------------------------------------------------------------------
// Setup integration
// ---------------------------------------------------------------------------

describe("setup", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns resolved config and provider", () => {
    const result = setup(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.config).toBeDefined();
    expect(result.value.provider).toBeDefined();
    expect(result.value.provider.name).toBeDefined();
  });

  it("passes modelOverride to config", () => {
    const result = setup(tmpDir, { modelOverride: "gpt-4o" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.config.modelOverride).toBe("gpt-4o");
  });

  it("passes permissionMode to config", () => {
    const result = setup(tmpDir, { permissionMode: "plan" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.config.permissionMode).toBe("plan");
  });
});

// ---------------------------------------------------------------------------
// CLI integration: --print / --stdin / default REPL
// ---------------------------------------------------------------------------

describe("CLI integration with mock provider", () => {
  /** Create mock deps that inject a MockProvider and capture REPL calls. */
  function makeMockDeps(printText = "mock response") {
    const mockProvider = new MockProvider({ chunks: [printText] });
    let replLaunched = false;
    let replProvider: Provider | undefined;

    const deps: CliDependencies = {
      createProviderFn: () => mockProvider,
      executePrintFn: async (provider, query) => {
        // Actually run through the real executePrint logic but with our mock
        const { executePrint } = await import("../../src/core/noninteractive.js");
        return executePrint(provider, query);
      },
      executeStdinFn: async (provider) => {
        // Return a simple result for testing
        return {
          text: printText,
          hasError: false,
          errorMessage: undefined,
          events: [],
        };
      },
      launchReplFn: async (opts) => {
        replLaunched = true;
        replProvider = opts.provider;
        // Don't actually render Ink in tests — resolve immediately
      },
    };

    return { deps, wasReplLaunched: () => replLaunched, getReplProvider: () => replProvider };
  }

  it("--print outputs mock provider text to stdout", async () => {
    let stdout = "";
    let stderr = "";
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    process.stdout.write = (chunk: unknown) => { if (typeof chunk === "string") stdout += chunk; return true; };
    process.stderr.write = (chunk: unknown) => { if (typeof chunk === "string") stderr += chunk; return true; };

    const { deps } = makeMockDeps("Hello from slc!");

    let exitCode = -1;
    const actionExitCode = { resolve: (code: number) => { exitCode = code; } };

    const program = createProgram(deps, actionExitCode);
    await program.parseAsync(["node", "slc", "--print", "Say hello"], { from: "node" });

    process.stdout.write = origOut;
    process.stderr.write = origErr;

    expect(exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(stdout).toContain("Hello from slc!");
    expect(stdout).not.toContain("no provider connected yet");
    expect(stderr).toBe("");
  });

  it("--print returns ERROR exit code when provider fails", async () => {
    let stderr = "";
    const origErr = process.stderr.write;
    process.stderr.write = (chunk: unknown) => { if (typeof chunk === "string") stderr += chunk; return true; };

    const deps: CliDependencies = {
      createProviderFn: () => {
        return new (class {
          readonly name = "failing";
          readonly capabilities = { toolUse: true, streaming: true, vision: true, promptCache: true, extendedThinking: true };
          async *chat() { throw new Error("API down"); }
        })() as unknown as Provider;
      },
    };

    let exitCode = -1;
    const actionExitCode = { resolve: (code: number) => { exitCode = code; } };
    const program = createProgram(deps, actionExitCode);
    await program.parseAsync(["node", "slc", "--print", "test"], { from: "node" });

    process.stderr.write = origErr;

    expect(exitCode).toBe(EXIT_CODE.ERROR);
    expect(stderr).toContain("API down");
  });

  it("--stdin outputs mock provider text", async () => {
    let stdout = "";
    const origOut = process.stdout.write;
    process.stdout.write = (chunk: unknown) => { if (typeof chunk === "string") stdout += chunk; return true; };

    const { deps } = makeMockDeps("stdin response");

    let exitCode = -1;
    const actionExitCode = { resolve: (code: number) => { exitCode = code; } };
    const program = createProgram(deps, actionExitCode);
    await program.parseAsync(["node", "slc", "--stdin"], { from: "node" });

    process.stdout.write = origOut;

    expect(exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(stdout).toContain("stdin response");
    expect(stdout).not.toContain("no provider connected yet");
  });

  it("default mode (no --print/--stdin) calls launchRepl", async () => {
    let stdout = "";
    const origOut = process.stdout.write;
    process.stdout.write = (chunk: unknown) => { if (typeof chunk === "string") stdout += chunk; return true; };

    const { deps, wasReplLaunched, getReplProvider } = makeMockDeps("repl test");

    let exitCode = -1;
    const actionExitCode = { resolve: (code: number) => { exitCode = code; } };
    const program = createProgram(deps, actionExitCode);
    await program.parseAsync(["node", "slc"], { from: "node" });

    process.stdout.write = origOut;

    expect(exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(wasReplLaunched()).toBe(true);
    expect(getReplProvider()).toBeDefined();
    // Should NOT contain the old P2 placeholder
    expect(stdout).not.toContain("no provider connected yet");
  });
});
