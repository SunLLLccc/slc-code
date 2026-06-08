// Tool registry — built-in tools take priority over MCP tools

import type { Tool } from "./base.js";

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  /** Built-in tools — cannot be overridden by MCP tools. */
  private readonly builtin = new Map<string, Tool>();
  /** MCP / external tools — lower priority. */
  private readonly external = new Map<string, Tool>();

  /** Register a built-in tool. Takes priority over any external tool.
   *  Also removes any existing external tool with the same name to prevent
   *  duplicates in list()/toProviderTools(). */
  registerBuiltin(tool: Tool): void {
    this.builtin.set(tool.name, tool);
    // Evict any external tool with the same name
    this.external.delete(tool.name);
  }

  /** Register an external (MCP) tool. Ignored if a built-in has the same name. */
  registerExternal(tool: Tool): void {
    // Built-in tools always win
    if (this.builtin.has(tool.name)) {
      return;
    }
    this.external.set(tool.name, tool);
  }

  /** Look up a tool by name. Built-in takes priority. */
  get(name: string): Tool | undefined {
    return this.builtin.get(name) ?? this.external.get(name);
  }

  /** Check if a tool is registered (built-in or external). */
  has(name: string): boolean {
    return this.builtin.has(name) || this.external.has(name);
  }

  /** List all registered tools (built-in first, then external). */
  list(): Tool[] {
    return [...this.builtin.values(), ...this.external.values()];
  }

  /** List only built-in tools. */
  listBuiltins(): Tool[] {
    return [...this.builtin.values()];
  }

  /** List only external (MCP) tools. */
  listExternal(): Tool[] {
    return [...this.external.values()];
  }

  /** Convert all registered tools to ProviderTool format for the engine. */
  toProviderTools(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.schema.input,
    }));
  }
}
