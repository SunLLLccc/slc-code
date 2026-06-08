// Git bare repo escape cleanup — PRD 8.2
//
// Sandbox commands may plant malicious git configs (bare repos, worktree refs,
// GIT_DIR overrides) that affect subsequent unsandboxed git operations.
//
// This module:
// 1. Detects suspicious git config residuals after sandbox execution
// 2. Cleans up dangerous configs that could redirect git operations
// 3. Returns a summary of what was found/cleaned

import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface CleanupResult {
  /** Whether suspicious git config was found */
  found: boolean;
  /** What was cleaned up */
  cleaned: string[];
  /** Any errors during cleanup */
  errors: string[];
}

/**
 * Check and clean up suspicious git config residuals in the given directory.
 * Called after sandbox execution to prevent bare repo escape attacks.
 */
export function cleanupGitEscape(cwd: string): CleanupResult {
  const result: CleanupResult = { found: false, cleaned: [], errors: [] };
  const resolvedCwd = resolve(cwd);

  // Check for suspicious bare repo indicators
  checkAndCleanBareRepo(resolvedCwd, result);

  // Check for malicious GIT_DIR environment leftovers in .git/config
  checkAndCleanGitConfig(resolvedCwd, result);

  // Check for suspicious worktree references
  checkAndCleanWorktreeRefs(resolvedCwd, result);

  return result;
}

/**
 * Detect and clean bare repo markers that could redirect git operations.
 * A bare repo has no .git directory — instead the root IS the git repo.
 */
function checkAndCleanBareRepo(cwd: string, result: CleanupResult): void {
  // Check for bare repo config at project root level
  const bareConfigPath = join(cwd, "config");
  const headPath = join(cwd, "HEAD");
  const objectsPath = join(cwd, "objects");

  // If cwd itself looks like a bare repo (has HEAD, objects, config but no .git)
  if (
    existsSync(headPath) &&
    existsSync(objectsPath) &&
    existsSync(bareConfigPath) &&
    !existsSync(join(cwd, ".git"))
  ) {
    result.found = true;
    // This looks like a bare repo — log but don't delete (could be intentional)
    result.cleaned.push(
      `detected potential bare repo at ${cwd} (HEAD + objects + config present without .git)`,
    );
  }

  // Check for injected bare repo inside project
  const suspiciousDirs = [".bare", ".git.bare", "git-bare"];
  for (const dir of suspiciousDirs) {
    const suspiciousPath = join(cwd, dir);
    if (existsSync(suspiciousPath)) {
      result.found = true;
      try {
        rmSync(suspiciousPath, { recursive: true, force: true });
        result.cleaned.push(`removed suspicious directory: ${dir}`);
      } catch (e) {
        result.errors.push(
          `failed to remove ${dir}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}

/**
 * Check for malicious git config entries that could redirect operations.
 */
function checkAndCleanGitConfig(cwd: string, result: CleanupResult): void {
  const gitConfigPath = join(cwd, ".git", "config");
  if (!existsSync(gitConfigPath)) return;

  try {
    const content = readFileSync(gitConfigPath, "utf-8");

    // Check for suspicious GIT_DIR overrides or remote URL injections
    const suspiciousPatterns = [
      /\[core\]\s*\n\s*worktree\s*=\s*[/\\]/i, // absolute worktree redirect
      /\[remote\s+"[^"]*"\]\s*\n\s*url\s*=\s*\|/i, // command injection via remote URL
      /\[include\]/i, // config include (could load malicious config)
      /GIT_DIR/i, // environment variable override
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(content)) {
        result.found = true;
        result.cleaned.push(
          `detected suspicious git config pattern: ${pattern.source.slice(0, 50)}`,
        );
        // Replace with safe defaults
        try {
          writeFileSync(gitConfigPath, "[core]\n\trepositoryformatversion = 0\n", "utf-8");
          result.cleaned.push("replaced .git/config with safe defaults");
        } catch (e) {
          result.errors.push(
            `failed to clean .git/config: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        break;
      }
    }
  } catch {
    // Can't read config — that's fine
  }
}

/**
 * Check for suspicious worktree references that could redirect operations.
 */
function checkAndCleanWorktreeRefs(cwd: string, result: CleanupResult): void {
  const worktreesPath = join(cwd, ".git", "worktrees");
  if (!existsSync(worktreesPath)) return;

  try {
    const entries = readdirSync(worktreesPath);
    for (const entry of entries) {
      const wtConfigPath = join(worktreesPath, entry, "config");
      if (existsSync(wtConfigPath)) {
        try {
          const content = readFileSync(wtConfigPath, "utf-8");
          if (content.includes("GIT_DIR") || content.includes("worktree = /")) {
            result.found = true;
            rmSync(join(worktreesPath, entry), { recursive: true, force: true });
            result.cleaned.push(`removed suspicious worktree: ${entry}`);
          }
        } catch {
          // Can't read worktree config
        }
      }
    }
  } catch {
    // Can't read worktrees dir
  }
}
