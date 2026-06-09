// NotebookEditTool — real Jupyter notebook (.ipynb) cell editing

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { isWithinProject } from "../../permissions/checker.js";

// ---------------------------------------------------------------------------
// Notebook cell types
// ---------------------------------------------------------------------------

interface NotebookCell {
  id?: string;
  cell_type: string;
  metadata: Record<string, unknown>;
  source: string[];
  outputs?: unknown[];
  execution_count?: number | null;
}

interface Notebook {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateCellId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

function findCellIndex(cells: NotebookCell[], cellId: string): number {
  return cells.findIndex((c) => c.id === cellId);
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const notebookEditTool: Tool = buildTool({
  name: "NotebookEdit",
  description: "Edit a Jupyter notebook cell",
  security: {
    readOnly: false,
    concurrencySafe: false,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        notebook_path: { type: "string", description: "Path to the notebook" },
        cell_id: { type: "string", description: "ID of the cell to edit" },
        new_source: { type: "string", description: "New source content" },
        cell_type: { type: "string", enum: ["code", "markdown"], description: "Cell type" },
        edit_mode: { type: "string", enum: ["replace", "insert", "delete"], description: "Edit mode (default: replace)" },
      },
      required: ["notebook_path", "cell_id", "new_source"],
    },
  },
  validate(input: ToolInput): string | undefined {
    const notebookPath = input.notebook_path as string;
    if (!notebookPath.endsWith(".ipynb")) {
      return "notebook_path must point to a .ipynb file";
    }
    const editMode = (input.edit_mode as string) ?? "replace";
    if (!["replace", "insert", "delete"].includes(editMode)) {
      return `edit_mode must be one of: replace, insert, delete (got "${editMode}")`;
    }
    return undefined;
  },
  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const notebookPath = resolve(context.cwd, input.notebook_path as string);
    const cellId = input.cell_id as string;
    const newSource = input.new_source as string;
    const cellType = (input.cell_type as string) ?? "code";
    const editMode = (input.edit_mode as string) ?? "replace";

    // Project boundary check
    if (!isWithinProject(notebookPath, context.cwd)) {
      return {
        output: "Path is outside project boundary",
        isError: true,
      };
    }

    // Read notebook
    let raw: string;
    try {
      raw = await readFile(notebookPath, "utf-8");
    } catch (err) {
      return {
        output: `Failed to read notebook: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    // Parse JSON
    let notebook: Notebook;
    try {
      notebook = JSON.parse(raw) as Notebook;
    } catch (err) {
      return {
        output: `Invalid notebook JSON: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    if (!Array.isArray(notebook.cells)) {
      return { output: "Invalid notebook: missing cells array", isError: true };
    }

    // Source lines: split by newline, keep trailing newline for all but last line
    const sourceLines = newSource.split("\n").map((line, i, arr) =>
      i < arr.length - 1 ? line + "\n" : line,
    );

    if (editMode === "delete") {
      const idx = findCellIndex(notebook.cells, cellId);
      if (idx === -1) {
        return { output: `Cell not found: ${cellId}`, isError: true };
      }
      notebook.cells.splice(idx, 1);
    } else if (editMode === "insert") {
      // Insert after the cell with cellId
      const idx = findCellIndex(notebook.cells, cellId);
      if (idx === -1) {
        return { output: `Cell not found: ${cellId}`, isError: true };
      }
      const newCell: NotebookCell = {
        id: generateCellId(),
        cell_type: cellType,
        metadata: {},
        source: sourceLines,
        ...(cellType === "code" ? { outputs: [], execution_count: null } : {}),
      };
      notebook.cells.splice(idx + 1, 0, newCell);
    } else {
      // replace
      const idx = findCellIndex(notebook.cells, cellId);
      if (idx === -1) {
        return { output: `Cell not found: ${cellId}`, isError: true };
      }
      notebook.cells[idx].source = sourceLines;
      if (cellType && notebook.cells[idx].cell_type !== cellType) {
        notebook.cells[idx].cell_type = cellType;
      }
    }

    // Write back
    try {
      await writeFile(notebookPath, JSON.stringify(notebook, null, 2) + "\n", "utf-8");
    } catch (err) {
      return {
        output: `Failed to write notebook: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    return { output: `Notebook edited: ${editMode} cell ${cellId}` };
  },
});
