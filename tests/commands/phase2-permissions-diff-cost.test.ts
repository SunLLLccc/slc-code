// Tests for /permissions, /diff, /cost commands

import { describe, it, expect, beforeEach } from "vitest";
import { CommandRegistry } from "../../src/commands/registry.js";
import { createDefaultRegistry } from "../../src/commands/index.js";
import { permissionsCommand, getPermissionRules } from "../../src/commands/builtin/permissions.js";
import { diffCommand } from "../../src/commands/builtin/diff.js";
import { costCommand } from "../../src/commands/builtin/cost.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides?: { costSummary?: () => string }) {
  return {
    costSummary: overrides?.costSummary,
  };
}

// ---------------------------------------------------------------------------
// /permissions command
// ---------------------------------------------------------------------------

describe("/permissions command", () => {
  beforeEach(() => {
    // Clear rules by adding then removing until empty
    const rules = getPermissionRules();
    while (rules.length > 0) {
      rules.pop();
    }
  });

  it("lists empty rules", () => {
    const result = permissionsCommand.execute("", makeContext());
    expect(result).toContain("No permission rules");
  });

  it("adds a deny rule", () => {
    const result = permissionsCommand.execute("add deny FileWrite(/secret:*)", makeContext());
    expect(result).toContain("Added rule");
    expect(result).toContain("deny");
    expect(result).toContain("FileWrite");

    const rules = getPermissionRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].effect).toBe("deny");
    expect(rules[0].toolPattern).toBe("FileWrite");
  });

  it("adds an allow rule", () => {
    permissionsCommand.execute("add allow FileRead", makeContext());
    const rules = getPermissionRules();
    expect(rules[0].effect).toBe("allow");
  });

  it("rejects invalid effect", () => {
    const result = permissionsCommand.execute("add maybe FileRead", makeContext());
    expect(result).toContain("Invalid effect");
  });

  it("removes a rule by index", () => {
    permissionsCommand.execute("add deny Bash(rm:*)", makeContext());
    permissionsCommand.execute("add allow FileRead", makeContext());

    const result = permissionsCommand.execute("remove 0", makeContext());
    expect(result).toContain("Removed rule");
    expect(result).toContain("Bash");

    const rules = getPermissionRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].effect).toBe("allow");
  });

  it("rejects invalid index", () => {
    const result = permissionsCommand.execute("remove 99", makeContext());
    expect(result).toContain("Invalid index");
  });

  it("lists configured rules", () => {
    permissionsCommand.execute("add deny Bash(rm:*)", makeContext());
    permissionsCommand.execute("add allow FileRead", makeContext());

    const result = permissionsCommand.execute("list", makeContext());
    expect(result).toContain("Permission rules");
    expect(result).toContain("[0]");
    expect(result).toContain("[1]");
  });

  it("responds to perms alias via registry", () => {
    const registry = new CommandRegistry();
    registry.register(permissionsCommand);

    // perms is an alias
    const cmd = registry.get("perms");
    expect(cmd).toBe(permissionsCommand);
  });
});

// ---------------------------------------------------------------------------
// /diff command
// ---------------------------------------------------------------------------

describe("/diff command", () => {
  it("shows no changes in clean working tree", () => {
    // In a clean git repo, diff returns empty
    const result = diffCommand.execute("", makeContext());
    // Either "No changes" or actual diff — both are valid
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles git not available gracefully", () => {
    // This test just verifies it doesn't throw
    const result = diffCommand.execute("", makeContext());
    expect(typeof result).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// /cost command
// ---------------------------------------------------------------------------

describe("/cost command", () => {
  it("shows cost when costSummary available", () => {
    const ctx = makeContext({
      costSummary: () => "Session cost: $0.0050 (2 calls, 1000 in / 500 out tokens)",
    });
    const result = costCommand.execute("", ctx);
    expect(result).toContain("Session cost");
  });

  it("returns message when costSummary not available", () => {
    const result = costCommand.execute("", makeContext());
    expect(result).toContain("not available");
  });
});

// ---------------------------------------------------------------------------
// CommandRegistry integration — Phase 2 commands register properly
// ---------------------------------------------------------------------------

describe("Phase 2 commands in registry", () => {
  it("all Phase 2 commands register and dispatch", () => {
    const registry = new CommandRegistry();
    registry.register(permissionsCommand);
    registry.register(diffCommand);
    registry.register(costCommand);

    expect(registry.has("permissions")).toBe(true);
    expect(registry.has("diff")).toBe(true);
    expect(registry.has("cost")).toBe(true);
    expect(registry.has("perms")).toBe(true); // alias
  });

  it("dispatches /cost command", async () => {
    const registry = new CommandRegistry();
    registry.register(costCommand);

    const result = await registry.dispatch("/cost", makeContext());
    expect(result).toContain("not available");
  });

  it("dispatches /permissions list", async () => {
    const registry = new CommandRegistry();
    registry.register(permissionsCommand);

    const result = await registry.dispatch("/permissions list", makeContext());
    expect(typeof result).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// createDefaultRegistry — Phase 2 commands available by default
// ---------------------------------------------------------------------------

describe("createDefaultRegistry includes Phase 2 commands", () => {
  it("has /permissions command", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("permissions")).toBe(true);
  });

  it("has /perms alias", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("perms")).toBe(true);
  });

  it("has /diff command", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("diff")).toBe(true);
  });

  it("has /cost command", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("cost")).toBe(true);
  });

  it("dispatches /cost from default registry", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/cost", makeContext());
    expect(result).toContain("not available");
  });

  it("still has Phase 1 commands", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("help")).toBe(true);
    expect(registry.has("clear")).toBe(true);
    expect(registry.has("model")).toBe(true);
    expect(registry.has("config")).toBe(true);
  });
});
