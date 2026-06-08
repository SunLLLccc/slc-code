// Tests for FileRead, FileWrite, FileEdit, Glob, Grep tools

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileReadTool } from "../../src/tools/builtin/file-read.js";
import { fileWriteTool } from "../../src/tools/builtin/file-write.js";
import { fileEditTool } from "../../src/tools/builtin/file-edit.js";
import { globTool } from "../../src/tools/builtin/glob.js";
import { grepTool } from "../../src/tools/builtin/grep.js";
import type { ToolContext } from "../../src/tools/base.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-p6-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function ctx(): ToolContext {
  return { cwd: testDir };
}

// ---------------------------------------------------------------------------
// FileReadTool
// ---------------------------------------------------------------------------

describe("FileReadTool", () => {
  it("reads file content", async () => {
    const filePath = join(testDir, "hello.txt");
    await writeFile(filePath, "Hello World", "utf-8");

    const result = await fileReadTool.execute({ path: filePath }, ctx());
    expect(result.output).toBe("Hello World");
    expect(result.isError).toBeFalsy();
  });

  it("reads with offset and limit", async () => {
    const filePath = join(testDir, "lines.txt");
    await writeFile(filePath, "line1\nline2\nline3\nline4\nline5", "utf-8");

    const result = await fileReadTool.execute(
      { path: filePath, offset: 2, limit: 2 },
      ctx(),
    );
    expect(result.output).toBe("line2\nline3");
  });

  it("returns error for missing file", async () => {
    const result = await fileReadTool.execute(
      { path: join(testDir, "nope.txt") },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not found");
  });

  it("validates empty path", () => {
    const err = fileReadTool.validate?.({ path: "" });
    expect(err).toBeTruthy();
  });

  it("validates missing path", () => {
    const err = fileReadTool.validate?.({});
    expect(err).toBeTruthy();
  });

  it("has correct security attributes", () => {
    expect(fileReadTool.security.readOnly).toBe(true);
    expect(fileReadTool.security.concurrencySafe).toBe(true);
    expect(fileReadTool.security.destructive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FileWriteTool
// ---------------------------------------------------------------------------

describe("FileWriteTool", () => {
  it("writes file content", async () => {
    const filePath = join(testDir, "output.txt");
    const result = await fileWriteTool.execute(
      { path: filePath, content: "written content" },
      ctx(),
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("written");

    // Verify file was actually written
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("written content");
  });

  it("creates parent directories", async () => {
    const filePath = join(testDir, "sub", "dir", "file.txt");
    const result = await fileWriteTool.execute(
      { path: filePath, content: "nested" },
      ctx(),
    );

    expect(result.isError).toBeFalsy();
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("nested");
  });

  it("returns contextModifier with filesWritten", async () => {
    const filePath = join(testDir, "mod.txt");
    const result = await fileWriteTool.execute(
      { path: filePath, content: "x" },
      ctx(),
    );

    expect(result.contextModifier).toEqual({ filesWritten: [filePath] });
  });

  it("validates empty path", () => {
    const err = fileWriteTool.validate?.({ path: "", content: "x" });
    expect(err).toBeTruthy();
  });

  it("has correct security attributes", () => {
    expect(fileWriteTool.security.readOnly).toBe(false);
    expect(fileWriteTool.security.concurrencySafe).toBe(false);
    expect(fileWriteTool.security.destructive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FileEditTool
// ---------------------------------------------------------------------------

describe("FileEditTool", () => {
  it("edits file with unique old_string", async () => {
    const filePath = join(testDir, "edit.txt");
    await writeFile(filePath, "Hello World\nSecond line", "utf-8");

    const result = await fileEditTool.execute(
      { path: filePath, old_string: "Hello World", new_string: "Hi Earth" },
      ctx(),
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("edited");

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("Hi Earth\nSecond line");
  });

  it("fails when old_string not found", async () => {
    const filePath = join(testDir, "edit.txt");
    await writeFile(filePath, "Hello World", "utf-8");

    const result = await fileEditTool.execute(
      { path: filePath, old_string: "Not here", new_string: "x" },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("not found");
  });

  it("fails when old_string is not unique", async () => {
    const filePath = join(testDir, "edit.txt");
    await writeFile(filePath, "dup\ndup\ndup", "utf-8");

    const result = await fileEditTool.execute(
      { path: filePath, old_string: "dup", new_string: "x" },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("not unique");
    expect(result.output).toContain("3 occurrences");
  });

  it("returns contextModifier with filesEdited", async () => {
    const filePath = join(testDir, "edit.txt");
    await writeFile(filePath, "unique text here", "utf-8");

    const result = await fileEditTool.execute(
      { path: filePath, old_string: "unique text here", new_string: "replaced" },
      ctx(),
    );

    expect(result.contextModifier).toEqual({ filesEdited: [filePath] });
  });

  it("validates empty old_string", () => {
    const err = fileEditTool.validate?.({ path: "/x", old_string: "", new_string: "y" });
    expect(err).toBeTruthy();
  });

  it("validates empty new_string", () => {
    const err = fileEditTool.validate?.({ path: "/x", old_string: "a", new_string: "" });
    expect(err).toBeTruthy();
  });

  it("returns error for missing file", async () => {
    const result = await fileEditTool.execute(
      { path: join(testDir, "missing.txt"), old_string: "x", new_string: "y" },
      ctx(),
    );
    expect(result.isError).toBe(true);
  });

  it("has correct security attributes", () => {
    expect(fileEditTool.security.readOnly).toBe(false);
    expect(fileEditTool.security.concurrencySafe).toBe(false);
    expect(fileEditTool.security.destructive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GlobTool
// ---------------------------------------------------------------------------

describe("GlobTool", () => {
  it("finds files matching pattern", async () => {
    await writeFile(join(testDir, "a.ts"), "");
    await writeFile(join(testDir, "b.ts"), "");
    await writeFile(join(testDir, "c.js"), "");

    const result = await globTool.execute(
      { pattern: "**/*.ts", path: testDir },
      ctx(),
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("Found 2 files");
    expect(result.output).toContain("a.ts");
    expect(result.output).toContain("b.ts");
  });

  it("returns no matches message for empty results", async () => {
    const result = await globTool.execute(
      { pattern: "**/*.xyz", path: testDir },
      ctx(),
    );

    expect(result.output).toContain("No files matched");
  });

  it("validates empty pattern", () => {
    const err = globTool.validate?.({ pattern: "" });
    expect(err).toBeTruthy();
  });

  it("has correct security attributes", () => {
    expect(globTool.security.readOnly).toBe(true);
    expect(globTool.security.concurrencySafe).toBe(true);
    expect(globTool.security.destructive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GrepTool
// ---------------------------------------------------------------------------

describe("GrepTool", () => {
  it("finds matching lines (Node fallback)", async () => {
    await writeFile(join(testDir, "code.ts"), "const x = 1;\nconst y = 2;\nconsole.log(x);", "utf-8");
    await writeFile(join(testDir, "other.txt"), "no match here", "utf-8");

    const result = await grepTool.execute(
      { pattern: "const", path: testDir, include: "*.ts" },
      ctx(),
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("Found");
    expect(result.output).toContain("const x");
  });

  it("returns no matches message", async () => {
    await writeFile(join(testDir, "empty.txt"), "nothing interesting", "utf-8");

    const result = await grepTool.execute(
      { pattern: "UNIQUE_PATTERN_12345", path: testDir },
      ctx(),
    );

    expect(result.output).toContain("No matches found");
  });

  it("validates empty pattern", () => {
    const err = grepTool.validate?.({ pattern: "" });
    expect(err).toBeTruthy();
  });

  it("has correct security attributes", () => {
    expect(grepTool.security.readOnly).toBe(true);
    expect(grepTool.security.concurrencySafe).toBe(true);
    expect(grepTool.security.destructive).toBe(false);
  });
});
