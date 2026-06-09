// Permission checker factory — integrates with P5 scheduler pipeline
// Enforces project boundary checks on path-bearing tools before mode/rule evaluation
// IMPORTANT: path resolution uses context.cwd (same as tool execute), boundary check uses projectRoot

import { resolve, relative } from "node:path";
import type { Tool, ToolInput, ToolContext } from "../tools/base.js";
import type { PermissionChecker } from "../tools/scheduler.js";
import type { PermissionMode } from "./modes.js";
import { checkModePermission } from "./modes.js";
import type { PermissionRule } from "./rules.js";
import { evaluateRules } from "./rules.js";

// ---------------------------------------------------------------------------
// Path utilities — shared between checker and tools
// ---------------------------------------------------------------------------

/**
 * Resolve a potentially-relative path against a base directory.
 * Both checker and tools MUST use this function with context.cwd as base
 * to ensure they resolve to the same target.
 */
export function resolveToolPath(inputPath: string, cwd: string): string {
  return resolve(cwd, inputPath);
}

/**
 * Check whether a resolved path is within (or equal to) the project root.
 * Uses node:path relative: if the result starts with ".." it's outside.
 */
export function isWithinProject(path: string, projectRoot: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(projectRoot);
  const rel = relative(resolvedRoot, resolvedPath);
  return !rel.startsWith("..") && !rel.startsWith("/");
}

/**
 * Normalize a path to a canonical form (forward slashes).
 */
export function normalizePath(p: string): string {
  return resolve(p).replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Permission checker
// ---------------------------------------------------------------------------

/**
 * Tool names that carry a `path` argument subject to project boundary checks.
 */
const PATH_TOOLS = new Set([
  "FileRead",
  "FileWrite",
  "FileEdit",
]);

/**
 * Tool names that use `path` as optional base directory.
 * When `input.path` is absent, they default to context.cwd.
 */
const CWD_TOOLS = new Set([
  "Glob",
  "Grep",
]);

/**
 * Build normalized input for rule evaluation: replace raw path with resolved absolute path.
 */
function buildNormalizedInput(
  tool: Tool,
  input: ToolInput,
  cwd: string,
): ToolInput {
  if (typeof input.path === "string") {
    return { ...input, path: resolveToolPath(input.path, cwd) };
  }
  return input;
}

export interface PermissionCheckerOptions {
  mode: PermissionMode;
  /** Static rules (from config) */
  rules: PermissionRule[];
  projectRoot: string;
  /**
   * Dynamic rules provider — called on each check to get latest runtime rules.
   * Merged with static rules: deny > ask > allow priority.
   */
  getRuntimeRules?: () => PermissionRule[];
  /**
   * Dynamic mode provider — called on each check to get current runtime mode.
   * When provided, overrides the static `mode` field.
   */
  getRuntimeMode?: () => PermissionMode;
}

export function createPermissionChecker(options: PermissionCheckerOptions): PermissionChecker {
  const { mode, rules: configRules, projectRoot, getRuntimeRules, getRuntimeMode } = options;

  return (tool: Tool, input: ToolInput, context: ToolContext) => {
    // Resolve the effective mode: runtime override > context > static config
    const effectiveMode: PermissionMode = getRuntimeMode?.() ?? (context.permissionMode as PermissionMode) ?? mode;
    // 0. Project boundary enforcement for path-bearing tools
    if (PATH_TOOLS.has(tool.name) && typeof input.path === "string") {
      const resolved = resolveToolPath(input.path, context.cwd);
      if (!isWithinProject(resolved, projectRoot)) {
        return "deny";
      }
    }

    // For Glob/Grep: check either explicit path or context.cwd
    if (CWD_TOOLS.has(tool.name)) {
      const targetPath = typeof input.path === "string"
        ? resolveToolPath(input.path, context.cwd)
        : context.cwd;
      if (!isWithinProject(targetPath, projectRoot)) {
        return "deny";
      }
    }

    // Build normalized input with resolved paths for rule evaluation
    const normalizedInput = buildNormalizedInput(tool, input, context.cwd);

    // Get latest runtime rules on each check (real-time /permissions updates)
    const runtimeRules = getRuntimeRules?.() ?? [];
    const allRules = [...configRules, ...runtimeRules];

    // 1. Explicit deny rules — highest priority
    const ruleResult = evaluateRules(allRules, tool.name, normalizedInput);
    if (ruleResult === "deny") return "deny";

    // 2. Explicit ask rules
    if (ruleResult === "ask") return "ask";

    // 3. Permission mode restrictions
    const modeDecision = checkModePermission(effectiveMode, tool);
    if (modeDecision === "deny") return "deny";
    if (modeDecision === "ask") {
      // 4. Explicit allow rules can override mode "ask"
      if (ruleResult === "allow") return "allow";
      return "ask";
    }

    // mode allows — proceed
    return "allow";
  };
}
