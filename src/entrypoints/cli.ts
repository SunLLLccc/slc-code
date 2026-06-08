#!/usr/bin/env node
// slc-code CLI entry point
//
// Bootstrap layer: handles fast-path flags (--version, --bare) and
// delegates to the full setup → provider → execution pipeline.

import { Command } from "commander";
import { resolve as resolvePath } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setup } from "../core/setup.js";
import { createProvider } from "../engine/providers/factory.js";
import { executePrint, executeStdin } from "../core/noninteractive.js";
import { createDefaultRegistry } from "../commands/index.js";
import { launchRepl } from "../repl/index.js";
import { logger } from "../utils/logger.js";
import { SlcError, errorMessage } from "../utils/errors.js";
import type { Provider } from "../engine/providers/base.js";
import type { CommandContext } from "../commands/registry.js";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

function getVersion(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    // dist/entrypoints/cli.js -> package.json (3 levels up)
    const pkgPath = resolvePath(thisFile, "..", "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------

/** 0 = success, 1 = general error, 2 = permission denied */
export const EXIT_CODE = {
  SUCCESS: 0,
  ERROR: 1,
  PERMISSION_DENIED: 2,
} as const;

// ---------------------------------------------------------------------------
// Dependency injection for testability
// ---------------------------------------------------------------------------

export interface CliDependencies {
  /** Create a Provider from resolved config. Defaults to createProvider. */
  createProviderFn?: typeof createProvider;
  /** Execute --print query. Defaults to executePrint. */
  executePrintFn?: typeof executePrint;
  /** Execute --stdin query. Defaults to executeStdin. */
  executeStdinFn?: typeof executeStdin;
  /** Launch REPL. Defaults to launchRepl. */
  launchReplFn?: typeof launchRepl;
}

// ---------------------------------------------------------------------------
// CLI program
// ---------------------------------------------------------------------------

/**
 * Create the Commander program.
 *
 * @param deps Optional dependency injection for testing.
 * @param actionExitCode A Promise resolver. The action handler resolves it
 *   with the desired exit code instead of calling process.exit(), making
 *   the program testable.
 */
export function createProgram(
  deps: CliDependencies = {},
  actionExitCode?: { resolve: (code: number) => void },
): Command {
  const version = getVersion();

  const doCreateProvider = deps.createProviderFn ?? createProvider;
  const doExecutePrint = deps.executePrintFn ?? executePrint;
  const doExecuteStdin = deps.executeStdinFn ?? executeStdin;
  const doLaunchRepl = deps.launchReplFn ?? launchRepl;

  const program = new Command();

  program
    .name("slc")
    .description("CLI coding agent platform")
    .version(version, "-v, --version", "Print version")
    .helpOption("-h, --help", "Print help")
    .option("-p, --print <query>", "Non-interactive single query")
    .option("--stdin", "Read query from stdin")
    .option("-m, --model <model>", "Override model")
    .option("--permission-mode <mode>", "Override permission mode")
    .option("--cwd <path>", "Set working directory")
    .option("--bare", "Disable all persistence (transcript + memory)")
    .exitOverride() // Prevent process.exit during normal flow
    .action(async (options) => {
      const cwd = options.cwd
        ? resolvePath(options.cwd)
        : process.cwd();

      const result = setup(cwd, {
        bare: options.bare ?? false,
        modelOverride: options.model,
        permissionMode: options.permissionMode,
      });

      if (result.ok === false) {
        process.stderr.write(`Error: ${result.error.message}\n`);
        actionExitCode?.resolve(EXIT_CODE.ERROR);
        return;
      }

      const { config, provider: resolved } = result.value;
      const model = config.modelOverride ?? config.model ?? resolved.defaultModel;

      // --print: non-interactive single query
      if (options.print) {
        try {
          const provider = doCreateProvider({
            provider: resolved,
            model,
          });
          const skipPromptAssembly = options.bare ?? false;
          const printResult = await doExecutePrint(provider, options.print, {
            cwd,
            skipPromptAssembly,
          });

          if (printResult.hasError) {
            process.stderr.write(`Error: ${printResult.errorMessage}\n`);
            actionExitCode?.resolve(EXIT_CODE.ERROR);
            return;
          }

          process.stdout.write(printResult.text);
          if (printResult.text && !printResult.text.endsWith("\n")) {
            process.stdout.write("\n");
          }
          actionExitCode?.resolve(EXIT_CODE.SUCCESS);
        } catch (e) {
          process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
          actionExitCode?.resolve(EXIT_CODE.ERROR);
        }
        return;
      }

      // --stdin: non-interactive from pipe
      if (options.stdin) {
        try {
          const provider = doCreateProvider({
            provider: resolved,
            model,
          });
          const skipPromptAssembly = options.bare ?? false;
          const stdinResult = await doExecuteStdin(provider, {
            cwd,
            skipPromptAssembly,
          });

          if (stdinResult.hasError) {
            process.stderr.write(`Error: ${stdinResult.errorMessage}\n`);
            actionExitCode?.resolve(EXIT_CODE.ERROR);
            return;
          }

          process.stdout.write(stdinResult.text);
          if (stdinResult.text && !stdinResult.text.endsWith("\n")) {
            process.stdout.write("\n");
          }
          actionExitCode?.resolve(EXIT_CODE.SUCCESS);
        } catch (e) {
          process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
          actionExitCode?.resolve(EXIT_CODE.ERROR);
        }
        return;
      }

      // Default: interactive REPL
      try {
        const provider = doCreateProvider({
          provider: resolved,
          model,
        });
        const registry = createDefaultRegistry();
        const ctx: CommandContext = {
          model,
          config: config as unknown as Record<string, unknown>,
        };

        await doLaunchRepl({
          provider,
          commandRegistry: registry,
          commandContext: ctx,
          model,
        });
        actionExitCode?.resolve(EXIT_CODE.SUCCESS);
      } catch (e) {
        process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
        actionExitCode?.resolve(EXIT_CODE.ERROR);
      }
    });

  return program;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<number> {
  // Fast-path: --version without loading anything else
  if (
    argv.length === 2 &&
    (argv[1] === "--version" || argv[1] === "-v")
  ) {
    process.stdout.write(`${getVersion()}\n`);
    return EXIT_CODE.SUCCESS;
  }

  let resolveAction: (code: number) => void = () => {};
  const actionExitCode = new Promise<number>((resolve) => {
    resolveAction = resolve;
  });

  const program = createProgram({}, { resolve: resolveAction });

  try {
    await program.parseAsync(argv, { from: "node" });
    // Wait for the action handler to resolve its exit code
    return await actionExitCode;
  } catch (error: unknown) {
    if (error instanceof SlcError) {
      logger.error(error.message);
      return EXIT_CODE.ERROR;
    }
    // Commander throws with exitCode property for --help / --version
    if (error && typeof error === "object" && "exitCode" in error) {
      // @ts-expect-error Commander internal
      return error.exitCode ?? EXIT_CODE.SUCCESS;
    }
    logger.error(`Unexpected error: ${errorMessage(error)}`);
    return EXIT_CODE.ERROR;
  }
}

// Run when executed directly (not when imported by tests or other modules)
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolvePath(process.argv[1]) === thisFile) {
  main(process.argv).then((code) => process.exit(code));
}
