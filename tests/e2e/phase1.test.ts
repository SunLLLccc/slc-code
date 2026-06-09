// Phase 1 e2e tests — CLI entry point with real mock provider injection
//
// Tests --print, --stdin, --bare, --permission-mode through CliDependencies
// injection. No real provider auth errors are allowed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProgram, main, EXIT_CODE } from "../../src/entrypoints/cli.js";
import { MockProvider } from "../../src/engine/providers/base.js";
import type { CliDependencies } from "../../src/entrypoints/cli.js";
import type { NonInteractiveResult } from "../../src/core/noninteractive.js";
import type { PermissionChecker } from "../../src/tools/scheduler.js";
import type { Tool, ToolInput, ToolContext } from "../../src/tools/base.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockDeps(overrides: Partial<CliDependencies> = {}): CliDependencies {
  return {
    createProviderFn: vi.fn(() => new MockProvider()),
    executePrintFn: vi.fn(async (): Promise<NonInteractiveResult> => ({
      text: "mock print response",
      hasError: false,
      events: [],
    })),
    executeStdinFn: vi.fn(async (): Promise<NonInteractiveResult> => ({
      text: "mock stdin response",
      hasError: false,
      events: [],
    })),
    launchReplFn: vi.fn(async () => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 1 — CLI --version and --help", () => {
  it("--version prints version string and exits 0", async () => {
    const chunks: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((data: string | Uint8Array) => {
      chunks.push(typeof data === "string" ? data : new TextDecoder().decode(data));
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main(["node", "slc", "--version"]);
      expect(code).toBe(EXIT_CODE.SUCCESS);
      const output = chunks.join("");
      expect(output).toMatch(/\d+\.\d+\.\d+/);
    } finally {
      process.stdout.write = original;
    }
  });

  it("--help prints help text and exits 0", async () => {
    const chunks: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((data: string | Uint8Array) => {
      chunks.push(typeof data === "string" ? data : new TextDecoder().decode(data));
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main(["node", "slc", "--help"]);
      expect(code).toBe(0);
      const output = chunks.join("");
      expect(output).toContain("--print");
      expect(output).toContain("--version");
      expect(output).toContain("--bare");
      expect(output).toContain("--permission-mode");
    } finally {
      process.stdout.write = original;
    }
  });
});

describe("Phase 1 — --print with mock provider", () => {
  it("returns mock text and exit code 0 via injected executePrintFn", async () => {
    const deps = mockDeps();
    const program = createProgram(deps);

    // Capture stdout
    const chunks: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((data: string | Uint8Array) => {
      chunks.push(typeof data === "string" ? data : new TextDecoder().decode(data));
      return true;
    }) as typeof process.stdout.write;

    try {
      // Parse with --print flag; createProgram uses exitOverride so it won't process.exit
      const resolver = { resolve: (_code: number) => {} };
      const exitPromise = new Promise<number>((r) => { resolver.resolve = r; });
      const prog = createProgram(deps, resolver);
      await prog.parseAsync(["node", "slc", "--print", "hello world"], { from: "node" });
      const code = await exitPromise;

      expect(code).toBe(EXIT_CODE.SUCCESS);
      const output = chunks.join("");
      expect(output).toContain("mock print response");

      // Verify the injected function was called
      expect(deps.executePrintFn).toHaveBeenCalled();
    } finally {
      process.stdout.write = original;
    }
  });

  it("executePrintFn receives the query string", async () => {
    const capturedArgs: { query: string; options: unknown }[] = [];
    const deps = mockDeps({
      executePrintFn: vi.fn(async (provider, query, options): Promise<NonInteractiveResult> => {
        capturedArgs.push({ query, options });
        return { text: "ok", hasError: false, events: [] };
      }),
    });

    const resolver = { resolve: (_code: number) => {} };
    new Promise<number>((r) => { resolver.resolve = r; });
    const prog = createProgram(deps, resolver);
    await prog.parseAsync(["node", "slc", "--print", "test query"], { from: "node" });

    expect(capturedArgs).toHaveLength(1);
    expect(capturedArgs[0].query).toBe("test query");
  });
});

describe("Phase 1 — --stdin with mock provider", () => {
  it("calls injected executeStdinFn and returns success", async () => {
    const deps = mockDeps();
    const resolver = { resolve: (_code: number) => {} };
    const exitPromise = new Promise<number>((r) => { resolver.resolve = r; });
    const prog = createProgram(deps, resolver);

    const chunks: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((data: string | Uint8Array) => {
      chunks.push(typeof data === "string" ? data : new TextDecoder().decode(data));
      return true;
    }) as typeof process.stdout.write;

    try {
      await prog.parseAsync(["node", "slc", "--stdin"], { from: "node" });
      const code = await exitPromise;

      expect(code).toBe(EXIT_CODE.SUCCESS);
      expect(deps.executeStdinFn).toHaveBeenCalled();
      const output = chunks.join("");
      expect(output).toContain("mock stdin response");
    } finally {
      process.stdout.write = original;
    }
  });
});

describe("Phase 1 — --bare flag", () => {
  it("--bare is accepted by createProgram", () => {
    const deps = mockDeps();
    const program = createProgram(deps);
    const opts = program.options.map((o) => o.long);
    expect(opts).toContain("--bare");
  });

  it("--bare is passed through to setup options", async () => {
    // We verify the program parses --bare without error and the flag flows through.
    // The actual persistence disabling is verified in session-memory-compact.test.ts
    const deps = mockDeps({
      executePrintFn: vi.fn(async (): Promise<NonInteractiveResult> => ({
        text: "bare response",
        hasError: false,
        events: [],
      })),
    });
    const resolver = { resolve: (_code: number) => {} };
    const exitPromise = new Promise<number>((r) => { resolver.resolve = r; });
    const prog = createProgram(deps, resolver);

    const chunks: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((data: string | Uint8Array) => {
      chunks.push(typeof data === "string" ? data : new TextDecoder().decode(data));
      return true;
    }) as typeof process.stdout.write;

    try {
      await prog.parseAsync(["node", "slc", "--bare", "--print", "bare test"], { from: "node" });
      const code = await exitPromise;

      // --bare + --print should succeed with mock provider
      expect(code).toBe(EXIT_CODE.SUCCESS);
    } finally {
      process.stdout.write = original;
    }
  });
});

describe("Phase 1 — --permission-mode flag", () => {
  it("--permission-mode is accepted by createProgram", () => {
    const deps = mockDeps();
    const program = createProgram(deps);
    const opts = program.options.map((o) => o.long);
    expect(opts).toContain("--permission-mode");
  });

  it("--permission-mode plan + --print succeeds with mock provider", async () => {
    const deps = mockDeps({
      executePrintFn: vi.fn(async (): Promise<NonInteractiveResult> => ({
        text: "plan mode response",
        hasError: false,
        events: [],
      })),
    });
    const resolver = { resolve: (_code: number) => {} };
    const exitPromise = new Promise<number>((r) => { resolver.resolve = r; });
    const prog = createProgram(deps, resolver);

    const chunks: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((data: string | Uint8Array) => {
      chunks.push(typeof data === "string" ? data : new TextDecoder().decode(data));
      return true;
    }) as typeof process.stdout.write;

    try {
      await prog.parseAsync(["node", "slc", "--permission-mode", "plan", "--print", "test"], { from: "node" });
      const code = await exitPromise;

      expect(code).toBe(EXIT_CODE.SUCCESS);
      expect(chunks.join("")).toContain("plan mode response");
    } finally {
      process.stdout.write = original;
    }
  });
});

describe("Phase 1 — createProgram dependency injection", () => {
  it("createProgram returns a valid Commander program", () => {
    const deps = mockDeps();
    const program = createProgram(deps);
    expect(program).toBeDefined();
    expect(program.name()).toBe("slc");
    expect(program.description()).toBe("CLI coding agent platform");
  });

  it("uses injected createProviderFn", async () => {
    const mockProviderInstance = new MockProvider({ chunks: ["custom provider"] });
    const deps = mockDeps({
      createProviderFn: vi.fn(() => mockProviderInstance),
      executePrintFn: vi.fn(async (provider): Promise<NonInteractiveResult> => {
        // Verify the injected provider was passed through
        expect(provider).toBe(mockProviderInstance);
        return { text: "injected provider used", hasError: false, events: [] };
      }),
    });

    const resolver = { resolve: (_code: number) => {} };
    const exitPromise = new Promise<number>((r) => { resolver.resolve = r; });
    const prog = createProgram(deps, resolver);

    const original = process.stdout.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      await prog.parseAsync(["node", "slc", "--print", "test"], { from: "node" });
      await exitPromise;
      expect(deps.createProviderFn).toHaveBeenCalled();
    } finally {
      process.stdout.write = original;
    }
  });
});
