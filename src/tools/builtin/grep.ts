import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import fg from "fast-glob";
import { resolveToolPath } from "../../permissions/checker.js";
import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";

const MAX_RESULTS = 100;

export const grepTool: Tool = buildTool({
  name: "Grep",
  description: "Search file contents for a pattern",
  security: {
    readOnly: true,
    concurrencySafe: true,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Search pattern (regex or literal)",
        },
        path: {
          type: "string",
          description: "Base directory (defaults to context.cwd)",
        },
        include: {
          type: "string",
          description: "File glob filter (e.g. '*.ts')",
        },
        caseInsensitive: {
          type: "boolean",
          description: "Case-insensitive search (default false)",
        },
      },
      required: ["pattern"],
    },
  },
  validate(input: ToolInput): string | undefined {
    const pattern = input.pattern;
    if (typeof pattern !== "string" || pattern.trim() === "") {
      return "pattern must be a non-empty string";
    }
    return undefined;
  },
  async execute(
    input: ToolInput,
    context: ToolContext,
  ): Promise<ToolOutput> {
    const pattern = input.pattern as string;
    // Resolve relative path against context.cwd — same as permission checker
    const cwd = input.path
      ? resolveToolPath(input.path as string, context.cwd)
      : context.cwd;
    const include = input.include as string | undefined;
    const caseInsensitive = input.caseInsensitive === true;

    try {
      const rgResult = tryRipgrep(pattern, cwd, include, caseInsensitive);
      if (rgResult !== null) {
        return rgResult;
      }

      // Node.js fallback
      return await nodeFallback(pattern, cwd, include, caseInsensitive);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Grep error: ${message}`, isError: true };
    }
  },
});

/**
 * Try ripgrep CLI. Returns null if rg is not available (ENOENT).
 */
function tryRipgrep(
  pattern: string,
  cwd: string,
  include: string | undefined,
  caseInsensitive: boolean,
): ToolOutput | null {
  const args: string[] = [
    "--no-heading",
    "--line-number",
    "--color",
    "never",
  ];

  if (caseInsensitive) {
    args.push("-i");
  }

  if (include) {
    args.push("--glob", include);
  }

  args.push(pattern, cwd);

  try {
    const stdout = execFileSync("rg", args, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });

    if (!stdout.trim()) {
      return { output: `No matches found for: ${pattern}` };
    }

    const lines = stdout.trim().split("\n");
    const limited = lines.slice(0, MAX_RESULTS);
    const suffix =
      lines.length > MAX_RESULTS
        ? `\n... and ${lines.length - MAX_RESULTS} more matches`
        : "";

    return {
      output: `Found ${lines.length} matches:\n${limited.join("\n")}${suffix}`,
    };
  } catch (err: unknown) {
    // rg returns exit code 1 when no matches found
    if (
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      (err as { status: number }).status === 1
    ) {
      return { output: `No matches found for: ${pattern}` };
    }

    // ENOENT means rg is not installed — fall through to Node fallback
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }

    // Other errors from rg
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Grep error: ${message}`, isError: true };
  }
}

/**
 * Node.js fallback: glob files, read each, search line by line.
 */
async function nodeFallback(
  pattern: string,
  cwd: string,
  include: string | undefined,
  caseInsensitive: boolean,
): Promise<ToolOutput> {
  const globPattern = include ?? "**/*";
  const files = await fg(globPattern, {
    cwd,
    absolute: true,
    ignore: ["**/node_modules/**", "**/.git/**"],
  });

  let regex: RegExp | null = null;
  try {
    regex = new RegExp(pattern, caseInsensitive ? "i" : "");
  } catch {
    // If pattern is not a valid regex, fall back to string includes
    regex = null;
  }

  const matches: string[] = [];

  for (const file of files) {
    if (matches.length >= MAX_RESULTS) break;

    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      // Skip files that can't be read (binary, permissions, etc.)
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= MAX_RESULTS) break;

      const line = lines[i];
      const matched = regex
        ? regex.test(line)
        : line.toLowerCase().includes(pattern.toLowerCase());

      if (matched) {
        matches.push(`${file}:${i + 1}:${line}`);
      }
    }
  }

  if (matches.length === 0) {
    return { output: `No matches found for: ${pattern}` };
  }

  return {
    output: `Found ${matches.length} matches:\n${matches.join("\n")}`,
  };
}
