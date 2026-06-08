import { readFile, writeFile } from "node:fs/promises";
import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { resolveToolPath } from "../../permissions/checker.js";

export const fileEditTool: Tool = buildTool({
  name: "FileEdit",
  description: "Edit a file by replacing an exact string match",
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
          description: "Path to the file to edit",
        },
        old_string: {
          type: "string",
          description: "Exact text to find in the file",
        },
        new_string: {
          type: "string",
          description: "Replacement text",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  validate(input: ToolInput): string | undefined {
    const path = input.path;
    if (typeof path !== "string" || path.trim() === "") {
      return "path must be a non-empty string";
    }
    if (typeof input.old_string !== "string" || input.old_string === "") {
      return "old_string must be a non-empty string";
    }
    if (typeof input.new_string !== "string" || input.new_string === "") {
      return "new_string must be a non-empty string";
    }
    return undefined;
  },
  async execute(
    input: ToolInput,
    context: ToolContext,
  ): Promise<ToolOutput> {
    const rawPath = input.path as string;
    const oldString = input.old_string as string;
    const newString = input.new_string as string;
    // Resolve relative paths against context.cwd — same as permission checker
    const filePath = resolveToolPath(rawPath, context.cwd);

    try {
      const content = await readFile(filePath, "utf-8");

      const firstIndex = content.indexOf(oldString);
      if (firstIndex === -1) {
        return { output: "old_string not found in file", isError: true };
      }

      const secondIndex = content.indexOf(oldString, firstIndex + 1);
      if (secondIndex !== -1) {
        // Count total occurrences
        let count = 1;
        let searchFrom = firstIndex + 1;
        while (content.indexOf(oldString, searchFrom) !== -1) {
          count++;
          searchFrom = content.indexOf(oldString, searchFrom) + 1;
        }
        return {
          output: `old_string is not unique in file (found ${count} occurrences). Add more context to make it unique.`,
          isError: true,
        };
      }

      const modified =
        content.slice(0, firstIndex) +
        newString +
        content.slice(firstIndex + oldString.length);

      await writeFile(filePath, modified, "utf-8");
      return {
        output: `File edited: ${filePath}`,
        contextModifier: { filesEdited: [filePath] },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Edit error: ${message}`, isError: true };
    }
  },
});
