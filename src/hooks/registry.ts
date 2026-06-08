// Hook registry — manages and executes hooks by type

import type { Hook, HookType, HookContext, HookResult } from "./types.js";
import type { PreToolUseHook } from "../tools/scheduler.js";
import type { Tool, ToolInput, ToolContext } from "../tools/base.js";

export class HookRegistry {
  private hooks: Map<HookType, Hook[]> = new Map();

  /** Register a hook for its declared type. */
  register(hook: Hook): void {
    const existing = this.hooks.get(hook.type) ?? [];
    existing.push(hook);
    this.hooks.set(hook.type, existing);
  }

  /** Get all hooks registered for a given type. */
  getHooks(type: HookType): Hook[] {
    return this.hooks.get(type) ?? [];
  }

  /** Run all hooks of a given type and return their results. */
  async runHooks(type: HookType, context: HookContext): Promise<HookResult[]> {
    const hooks = this.getHooks(type);
    const results: HookResult[] = [];
    for (const hook of hooks) {
      results.push(await hook.handler(context));
    }
    return results;
  }

  /**
   * Create a PreToolUseHook adapter for the P5 scheduler pipeline.
   * Runs all registered PreToolUse hooks; any deny blocks execution.
   */
  toPreToolUseHooks(): PreToolUseHook[] {
    const preHooks = this.getHooks("PreToolUse");
    if (preHooks.length === 0) return [];

    // Capture `this` reference for use inside the adapter
    const registry = this;

    return [{
      name: "hook-registry-adapter",
      async run(tool: Tool, input: ToolInput, context: ToolContext): Promise<"allow" | "deny"> {
        const results = await registry.runHooks("PreToolUse", {
          toolName: tool.name,
          input,
          cwd: context.cwd,
        });
        // Any deny → deny
        if (results.some((r: HookResult) => r.action === "deny")) return "deny";
        return "allow";
      },
    }];
  }
}
