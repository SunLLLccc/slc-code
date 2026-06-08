// Hook registry — manages and executes hooks by type

import type { Hook, HookType, HookContext, HookResult } from "./types.js";

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
}
