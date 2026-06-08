import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { resolveToolPath } from "../../permissions/checker.js";

export const fileWriteTool: Tool = buildTool({
  name: "FileWrite",
  description: "Create or overwrite a file with content",
  security: {
    readOnly: false,
    concurrencySafe: false,
    destructive: true,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to write",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
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
    const content = input.content as string;
    // Resolve relative paths against context.cwd — same as permission checker
    const filePath = resolveToolPath(rawPath, context.cwd);

    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf-8");
      return {
        output: `File written: ${filePath}`,
        contextModifier: { filesWritten: [filePath] },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Write error: ${message}`, isError: true };
    }
  },
});
