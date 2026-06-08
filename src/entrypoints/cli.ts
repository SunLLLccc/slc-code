#!/usr/bin/env node
// slc-code CLI entry point
//
// Bootstrap layer: handles fast-path flags (--version, --bare) and
// delegates to the full setup/repl pipeline.

import { Command } from "commander";
import { resolve as resolvePath } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setup } from "../core/setup.js";
import { logger } from "../utils/logger.js";
import { SlcError, errorMessage } from "../utils/errors.js";

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
// CLI program
// ---------------------------------------------------------------------------

/**
 * Create the Commander program.
 *
 * @param actionExitCode A Promise resolver. The action handler resolves it
 *   with the desired exit code instead of calling process.exit(), making
 *   the program testable.
 */
export function createProgram(
  actionExitCode?: { resolve: (code: number) => void },
): Command {
  const version = getVersion();

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
        logger.error(`Setup failed: ${result.error.message}`);
        actionExitCode?.resolve(EXIT_CODE.ERROR);
        return;
      }

      const { config, provider } = result.value;

      if (options.print) {
        process.stdout.write(
          `[slc] --print mode requested with model ${provider.defaultModel}, but no provider connected yet (P2).\n`,
        );
        actionExitCode?.resolve(EXIT_CODE.SUCCESS);
        return;
      }

      if (options.stdin) {
        process.stdout.write(
          `[slc] --stdin mode requested, but no provider connected yet (P2).\n`,
        );
        actionExitCode?.resolve(EXIT_CODE.SUCCESS);
        return;
      }

      // Default: would launch REPL here (P1+).
      // For now, print a placeholder.
      logger.info(
        `slc v${version} | provider: ${provider.name} | model: ${provider.defaultModel} | bare: ${config.bare ?? false}`,
      );
      actionExitCode?.resolve(EXIT_CODE.SUCCESS);
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

  const program = createProgram({ resolve: resolveAction });

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
