import { describe, it, expect } from "vitest";
import { HookRegistry } from "../../src/hooks/registry.js";
import type { Hook, HookResult } from "../../src/hooks/types.js";

describe("HookRegistry", () => {
  describe("register and getHooks", () => {
    it("registers a hook and retrieves it by type", () => {
      const registry = new HookRegistry();
      const hook: Hook = {
        name: "test-hook",
        type: "PreToolUse",
        handler: async () => ({ action: "allow" }),
      };
      registry.register(hook);

      const hooks = registry.getHooks("PreToolUse");
      expect(hooks).toHaveLength(1);
      expect(hooks[0].name).toBe("test-hook");
    });

    it("returns empty array for unregistered type", () => {
      const registry = new HookRegistry();
      const hooks = registry.getHooks("PostToolUse");
      expect(hooks).toEqual([]);
    });

    it("registers multiple hooks for the same type", () => {
      const registry = new HookRegistry();
      registry.register({
        name: "hook-1",
        type: "PreToolUse",
        handler: async () => ({ action: "allow" }),
      });
      registry.register({
        name: "hook-2",
        type: "PreToolUse",
        handler: async () => ({ action: "deny", reason: "blocked" }),
      });

      const hooks = registry.getHooks("PreToolUse");
      expect(hooks).toHaveLength(2);
    });

    it("keeps hooks for different types separate", () => {
      const registry = new HookRegistry();
      registry.register({
        name: "pre-hook",
        type: "PreToolUse",
        handler: async () => ({ action: "allow" }),
      });
      registry.register({
        name: "post-hook",
        type: "PostToolUse",
        handler: async () => ({ action: "allow" }),
      });

      expect(registry.getHooks("PreToolUse")).toHaveLength(1);
      expect(registry.getHooks("PostToolUse")).toHaveLength(1);
      expect(registry.getHooks("PreCompact")).toHaveLength(0);
    });

    it("starts with an empty registry", () => {
      const registry = new HookRegistry();
      expect(registry.getHooks("PreToolUse")).toEqual([]);
      expect(registry.getHooks("PostToolUse")).toEqual([]);
      expect(registry.getHooks("PreCompact")).toEqual([]);
      expect(registry.getHooks("SessionStart")).toEqual([]);
    });
  });

  describe("runHooks", () => {
    it("runs a single hook that allows", async () => {
      const registry = new HookRegistry();
      registry.register({
        name: "allow-hook",
        type: "PreToolUse",
        handler: async () => ({ action: "allow" }),
      });

      const results = await registry.runHooks("PreToolUse", { toolName: "bash" });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("allow");
    });

    it("runs a single hook that denies", async () => {
      const registry = new HookRegistry();
      registry.register({
        name: "deny-hook",
        type: "PreToolUse",
        handler: async () => ({ action: "deny", reason: "not allowed" }),
      });

      const results = await registry.runHooks("PreToolUse", { toolName: "bash" });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("deny");
      expect(results[0].reason).toBe("not allowed");
    });

    it("runs multiple hooks and returns all results", async () => {
      const registry = new HookRegistry();
      registry.register({
        name: "allow-hook",
        type: "PreToolUse",
        handler: async () => ({ action: "allow" }),
      });
      registry.register({
        name: "deny-hook",
        type: "PreToolUse",
        handler: async () => ({ action: "deny", reason: "blocked" }),
      });

      const results = await registry.runHooks("PreToolUse", { toolName: "bash" });
      expect(results).toHaveLength(2);
      expect(results[0].action).toBe("allow");
      expect(results[1].action).toBe("deny");
    });

    it("returns empty array when no hooks registered for type", async () => {
      const registry = new HookRegistry();
      const results = await registry.runHooks("PreToolUse", {});
      expect(results).toEqual([]);
    });

    it("passes context to hook handlers", async () => {
      const registry = new HookRegistry();
      let receivedContext: Record<string, unknown> | undefined;
      registry.register({
        name: "spy-hook",
        type: "PreToolUse",
        handler: async (ctx) => {
          receivedContext = ctx;
          return { action: "allow" };
        },
      });

      const context = { toolName: "bash", input: { command: "ls" } };
      await registry.runHooks("PreToolUse", context);
      expect(receivedContext).toEqual(context);
    });
  });

  describe("hook types", () => {
    it("supports PreToolUse type", async () => {
      const registry = new HookRegistry();
      registry.register({
        name: "pre-tool",
        type: "PreToolUse",
        handler: async () => ({ action: "allow" }),
      });

      const results = await registry.runHooks("PreToolUse", {});
      expect(results).toHaveLength(1);
    });

    it("supports PostToolUse type", async () => {
      const registry = new HookRegistry();
      registry.register({
        name: "post-tool",
        type: "PostToolUse",
        handler: async () => ({ action: "allow" }),
      });

      const results = await registry.runHooks("PostToolUse", {});
      expect(results).toHaveLength(1);
    });

    it("supports PreCompact type", async () => {
      const registry = new HookRegistry();
      registry.register({
        name: "pre-compact",
        type: "PreCompact",
        handler: async () => ({ action: "allow" }),
      });

      const results = await registry.runHooks("PreCompact", {});
      expect(results).toHaveLength(1);
    });

    it("supports SessionStart type", async () => {
      const registry = new HookRegistry();
      registry.register({
        name: "session-start",
        type: "SessionStart",
        handler: async () => ({ action: "allow" }),
      });

      const results = await registry.runHooks("SessionStart", {});
      expect(results).toHaveLength(1);
    });
  });
});
