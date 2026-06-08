import { readFile } from "node:fs/promises";
import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { resolveToolPath } from "../../permissions/checker.js";

export const fileReadTool: Tool = buildTool({
  name: "FileRead",
  description: "Read file contents from disk",
  security: {
    readOnly: true,
    concurrencySafe: true,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read" },
        offset: {
          type: "integer",
          description: "1-indexed line number to start reading from",
        },
        limit: {
          type: "integer",
          description: "Number of lines to read",
        },
      },
      required: ["path"],
    },
  },
  validate(input: ToolInput): string | undefined {
    const path = input.path;
    if (typeof path !== "string" || path.trim() === "") {
      return "path must be a non-empty string";
    }
    return undefined;
  },
  async execute(
    input: ToolInput,
    context: ToolContext,
  ): Promise<ToolOutput> {
    const rawPath = input.path as string;
    // Resolve relative paths against context.cwd — same as permission checker
    const filePath = resolveToolPath(rawPath, context.cwd);
    const offset = input.offset as number | undefined;
    const limit = input.limit as number | undefined;

    try {
      const content = await readFile(filePath, "utf-8");

      if (offset !== undefined || limit !== undefined) {
        const lines = content.split("\n");
        const start = offset !== undefined ? Math.max(offset - 1, 0) : 0;
        const end =
          limit !== undefined ? Math.min(start + limit, lines.length) : lines.length;
        return { output: lines.slice(start, end).join("\n") };
      }

      return { output: content };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { output: `File not found: ${filePath}`, isError: true };
      }
      return { output: `Read error: ${message}`, isError: true };
    }
  },
});
