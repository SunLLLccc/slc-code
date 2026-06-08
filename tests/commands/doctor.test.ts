// Tests for /doctor command

import { describe, it, expect } from "vitest";
import { doctorCommand } from "../../src/commands/builtin/doctor.js";
import { createDefaultRegistry } from "../../src/commands/index.js";

// ---------------------------------------------------------------------------
// /doctor output
// ---------------------------------------------------------------------------

describe("/doctor command", () => {
  it("returns a non-empty string", () => {
    const result = doctorCommand.execute("", {});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes Node.js version info", () => {
    const result = doctorCommand.execute("", {});
    expect(result).toContain("Node.js");
    expect(result).toContain(process.version);
  });

  it("includes config directory", () => {
    const result = doctorCommand.execute("", {});
    expect(result).toContain(".slc");
  });

  it("includes provider status", () => {
    const result = doctorCommand.execute("", {});
    // Either "configured" or "not set" — both are valid
    expect(result).toContain("Provider:");
  });

  it("includes sandbox status", () => {
    const result = doctorCommand.execute("", {});
    expect(result).toContain("Sandbox:");
  });

  it("includes ripgrep status", () => {
    const result = doctorCommand.execute("", {});
    expect(result).toContain("ripgrep");
  });

  it("includes settings file status", () => {
    const result = doctorCommand.execute("", {});
    expect(result).toContain("Settings file:");
  });

  it("does not leak API key values", () => {
    const result = doctorCommand.execute("", {});
    // Should never contain actual key-like strings
    const apiKeyPattern = /sk-[a-zA-Z0-9]{20,}/;
    expect(apiKeyPattern.test(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /doctor registered in default registry
// ---------------------------------------------------------------------------

describe("/doctor in createDefaultRegistry", () => {
  it("has /doctor command", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("doctor")).toBe(true);
  });

  it("dispatches /doctor", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch("/doctor", {});
    expect(result).toContain("Node.js");
  });
});
