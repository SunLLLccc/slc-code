import fg from "fast-glob";
import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { resolveToolPath } from "../../permissions/checker.js";

export const globTool: Tool = buildTool({
  name: "Glob",
  description: "Search for files matching a glob pattern",
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
          description: "Glob pattern (e.g. '**/*.ts')",
        },
        path: {
          type: "string",
          description:
            "Base directory for search (defaults to context.cwd)",
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

    try {
      const files = await fg(pattern, {
        cwd,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.git/**"],
      });

      if (files.length === 0) {
        return { output: `No files matched the pattern: ${pattern}` };
      }

      return {
        output: `Found ${files.length} files:\n${files.join("\n")}`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Glob error: ${message}`, isError: true };
    }
  },
});
