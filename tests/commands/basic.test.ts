// Tests for command registry and Phase 1 builtin commands

import { describe, it, expect } from "vitest";
import { CommandRegistry } from "../../src/commands/registry.js";
import { createDefaultRegistry } from "../../src/commands/index.js";
import type { CommandContext } from "../../src/commands/registry.js";

// ---------------------------------------------------------------------------
// CommandRegistry
// ---------------------------------------------------------------------------

describe("CommandRegistry", () => {
  it("registers and retrieves commands by name", () => {
    const registry = new CommandRegistry();
    registry.register({
      name: "test",
      description: "Test command",
      execute: () => "ok",
    });
    expect(registry.has("test")).toBe(true);
    expect(registry.get("test")?.name).toBe("test");
  });

  it("registers and resolves aliases", () => {
    const registry = new CommandRegistry();
    registry.register({
      name: "help",
      description: "Help",
      aliases: ["h", "?"],
      execute: () => "help output",
    });
    expect(registry.has("h")).toBe(true);
    expect(registry.has("?")).toBe(true);
    expect(registry.get("h")?.name).toBe("help");
  });

  it("list() excludes hidden commands", () => {
    const registry = new CommandRegistry();
    registry.register({ name: "visible", description: "V", execute: () => "" });
    registry.register({
      name: "secret",
      description: "S",
      hidden: true,
      execute: () => "",
    });
    const list = registry.list();
    expect(list.some((c) => c.name === "visible")).toBe(true);
    expect(list.some((c) => c.name === "secret")).toBe(false);
  });

  it("dispatch() executes command and returns output", async () => {
    const registry = new CommandRegistry();
    registry.register({
      name: "echo",
      description: "Echo",
      execute: (args) => `Echo: ${args}`,
    });
    const result = await registry.dispatch("/echo hello world");
    expect(result).toBe("Echo: hello world");
  });

  it("dispatch() returns error message for unknown command", async () => {
    const registry = new CommandRegistry();
    const result = await registry.dispatch("/nonexistent");
    expect(result).toContain("Unknown command");
  });

  it("dispatch() throws for non-slash input", async () => {
    const registry = new CommandRegistry();
    await expect(registry.dispatch("hello")).rejects.toThrow(
      "Not a slash command",
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 1 builtin commands via createDefaultRegistry
// ---------------------------------------------------------------------------

describe("Phase 1 builtin commands", () => {
  const context: CommandContext = {};

  it("/help lists available commands", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/help", context);
    expect(result).toContain("/help");
    expect(result).toContain("/clear");
    expect(result).toContain("/model");
    expect(result).toContain("/config");
  });

  it("/help resolves aliases h and ?", async () => {
    const registry = createDefaultRegistry();
    const r1 = await registry.dispatch("/h", context);
    expect(r1).toContain("/help");
    const r2 = await registry.dispatch("/?", context);
    expect(r2).toContain("/help");
  });

  it("/clear clears conversation when handler is set", async () => {
    let cleared = false;
    const ctx: CommandContext = {
      clearConversation: () => {
        cleared = true;
      },
    };
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/clear", ctx);
    expect(result).toContain("cleared");
    expect(cleared).toBe(true);
  });

  it("/model shows current model when no args", async () => {
    const registry = createDefaultRegistry();
    const ctx: CommandContext = { model: "gpt-4o" };
    const result = await registry.dispatch("/model", ctx);
    expect(result).toContain("gpt-4o");
  });

  it("/model switches model when args provided", async () => {
    let newModel = "";
    const registry = createDefaultRegistry();
    const ctx: CommandContext = {
      model: "gpt-4o",
      setModel: (m: string) => {
        newModel = m;
      },
    };
    const result = await registry.dispatch("/model claude-sonnet-4-6", ctx);
    expect(result).toContain("claude-sonnet-4-6");
    expect(newModel).toBe("claude-sonnet-4-6");
  });

  it("/config shows current configuration", async () => {
    const registry = createDefaultRegistry();
    const ctx: CommandContext = {
      config: { model: "gpt-4o", bare: false },
    };
    const result = await registry.dispatch("/config", ctx);
    expect(result).toContain("gpt-4o");
  });

  it("/config returns message when no config", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/config", {});
    expect(result).toContain("No configuration");
  });
});
