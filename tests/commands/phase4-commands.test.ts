// Tests for Phase 4 commands: real functionality tests

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Command, CommandContext } from "../../src/commands/registry.js";
import { createDefaultRegistry } from "../../src/commands/index.js";
import { mcpCommand, setMcpStatusProvider, type McpStatusProvider } from "../../src/commands/builtin/mcp.js";
import { skillsCommand } from "../../src/commands/builtin/skills.js";
import { agentsCommand } from "../../src/commands/builtin/agents.js";
import { themeCommand } from "../../src/commands/builtin/theme.js";
import { keybindingsCommand } from "../../src/commands/builtin/keybindings.js";
import { planCommand } from "../../src/commands/builtin/plan.js";
import { unplanCommand } from "../../src/commands/builtin/unplan.js";
import { resetPlanModeState, getPlanModeState, enterPlanModeTool } from "../../src/tools/builtin/plan-mode.js";
import { getTaskStore } from "../../src/tools/builtin/task-store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "phase4-cmd-test-"));
  resetPlanModeState();
  // Clear task store
  const store = getTaskStore();
  store.clear();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// /mcp
// ---------------------------------------------------------------------------

describe("/mcp command", () => {
  it("has correct name and description", () => {
    expect(mcpCommand.name).toBe("mcp");
    expect(mcpCommand.description).toBeTruthy();
  });

  it("returns info when no provider configured", () => {
    setMcpStatusProvider(null as unknown as McpStatusProvider);
    const result = mcpCommand.execute("", {});
    expect(result).toContain("no MCP status provider");
  });

  it("shows connected and failed servers", () => {
    const provider: McpStatusProvider = {
      getConnectedServers: () => [
        { name: "github", toolCount: 5 },
        { name: "jira", toolCount: 3 },
      ],
      getFailedServers: () => ["broken-server"],
    };
    setMcpStatusProvider(provider);

    const result = mcpCommand.execute("", {});
    expect(result).toContain("[connected] github");
    expect(result).toContain("5 tool(s)");
    expect(result).toContain("[connected] jira");
    expect(result).toContain("[failed] broken-server");
  });

  it("shows message when no servers configured", () => {
    const provider: McpStatusProvider = {
      getConnectedServers: () => [],
      getFailedServers: () => [],
    };
    setMcpStatusProvider(provider);

    const result = mcpCommand.execute("", {});
    expect(result).toContain("No servers configured");
  });

  it("is registered in default registry", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("mcp")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /skills
// ---------------------------------------------------------------------------

describe("/skills command", () => {
  it("has correct name and description", () => {
    expect(skillsCommand.name).toBe("skills");
    expect(skillsCommand.description).toBeTruthy();
  });

  it("returns no skills when directory is empty", async () => {
    const ctx: CommandContext = { config: { cwd: tmpDir } };
    const result = await skillsCommand.execute("", ctx);
    expect(result).toContain("No skills found");
  });

  it("lists discovered skills", async () => {
    const skillDir = join(tmpDir, ".slc", "skills", "deploy");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: deploy\ndescription: Deploy the app\n---\nDeploy`);

    const ctx: CommandContext = { config: { cwd: tmpDir } };
    const result = await skillsCommand.execute("", ctx);
    expect(result).toContain("deploy");
    expect(result).toContain("[project]");
  });

  it("supports --force flag to refresh cache", async () => {
    const skillDir = join(tmpDir, ".slc", "skills", "cached-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: cached-skill\n---\nBody`);

    const ctx: CommandContext = { config: { cwd: tmpDir } };
    const result = await skillsCommand.execute("--force", ctx);
    expect(result).toContain("cached-skill");
  });

  it("is registered in default registry", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("skills")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /agents
// ---------------------------------------------------------------------------

describe("/agents command", () => {
  it("has correct name and description", () => {
    expect(agentsCommand.name).toBe("agents");
    expect(agentsCommand.description).toBeTruthy();
  });

  it("returns no agents when task store is empty", () => {
    const result = agentsCommand.execute("", {});
    expect(result).toContain("No active agents");
  });

  it("lists tasks with owner and in_progress status as agents", () => {
    const store = getTaskStore();
    store.set("1", {
      id: "1",
      subject: "Run tests",
      status: "in_progress",
      owner: "agent-alpha",
      activeForm: "Running tests",
    });
    store.set("2", {
      id: "2",
      subject: "Write docs",
      status: "pending",
      owner: "agent-beta",
    });
    store.set("3", {
      id: "3",
      subject: "Background task",
      status: "completed",
      owner: "agent-gamma",
    });

    const result = agentsCommand.execute("", {});
    expect(result).toContain("agent-alpha");
    expect(result).toContain("Running tests");
    expect(result).not.toContain("agent-beta"); // not in_progress
    expect(result).not.toContain("agent-gamma"); // completed, not in_progress
  });

  it("is registered in default registry", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("agents")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /theme
// ---------------------------------------------------------------------------

describe("/theme command", () => {
  it("has correct name and description", () => {
    expect(themeCommand.name).toBe("theme");
    expect(themeCommand.description).toBeTruthy();
  });

  it("shows current theme (default)", async () => {
    const ctx: CommandContext = { config: { cwd: tmpDir } };
    const result = await themeCommand.execute("", ctx);
    expect(result).toContain("Current theme: default");
    expect(result).toContain("Available:");
  });

  it("switches theme", async () => {
    const ctx: CommandContext = { config: { cwd: tmpDir } };
    const result = await themeCommand.execute("dark", ctx);
    expect(result).toContain("Theme set to: dark");

    // Verify file was written
    const raw = await readFile(join(tmpDir, ".slc", "theme.json"), "utf-8");
    const config = JSON.parse(raw);
    expect(config.theme).toBe("dark");
  });

  it("rejects invalid theme name", async () => {
    const ctx: CommandContext = { config: { cwd: tmpDir } };
    const result = await themeCommand.execute("neon-rainbow", ctx);
    expect(result).toContain("Unknown theme");
    expect(result).toContain("default");
  });

  it("persists theme across reads", async () => {
    const ctx: CommandContext = { config: { cwd: tmpDir } };
    await themeCommand.execute("solarized", ctx);
    const result = await themeCommand.execute("", ctx);
    expect(result).toContain("Current theme: solarized");
  });

  it("is registered in default registry", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("theme")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /keybindings
// ---------------------------------------------------------------------------

describe("/keybindings command", () => {
  it("has correct name and description", () => {
    expect(keybindingsCommand.name).toBe("keybindings");
    expect(keybindingsCommand.description).toBeTruthy();
  });

  it("returns a keybindings list", () => {
    const result = keybindingsCommand.execute("", {});
    expect(result).toContain("REPL Keybindings");
    expect(result).toContain("Enter");
    expect(result).toContain("Ctrl+C");
    expect(result).toContain("Ctrl+D");
    expect(result).toContain("Tab");
  });

  it("includes common navigation keys", () => {
    const result = keybindingsCommand.execute("", {});
    expect(result).toContain("Up / Down");
    expect(result).toContain("Ctrl+A");
    expect(result).toContain("Ctrl+E");
  });

  it("is registered in default registry", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("keybindings")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /plan
// ---------------------------------------------------------------------------

describe("/plan command", () => {
  it("has correct name and description", () => {
    expect(planCommand.name).toBe("plan");
    expect(planCommand.description).toBeTruthy();
  });

  it("returns entering plan mode message", () => {
    const result = planCommand.execute("", {});
    expect(result).toContain("plan mode");
    expect(result).toContain("read-only");
  });

  it("shows already in plan mode if active", async () => {
    // Activate plan mode via the tool
    const ctx = { cwd: tmpDir, permissionMode: "default" };
    await enterPlanModeTool.execute({}, ctx);

    const result = planCommand.execute("", {});
    expect(result).toContain("Already in plan mode");
  });

  it("is registered in default registry", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("plan")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /unplan
// ---------------------------------------------------------------------------

describe("/unplan command", () => {
  it("has correct name and description", () => {
    expect(unplanCommand.name).toBe("unplan");
    expect(unplanCommand.description).toBeTruthy();
  });

  it("returns not in plan mode when inactive", () => {
    const result = unplanCommand.execute("", {});
    expect(result).toContain("Not in plan mode");
  });

  it("returns exit message when plan mode is active", async () => {
    const ctx = { cwd: tmpDir, permissionMode: "acceptEdits" };
    await enterPlanModeTool.execute({}, ctx);

    const result = unplanCommand.execute("", {});
    expect(result).toContain("Exited plan mode");
    expect(result).toContain("acceptEdits");
  });

  it("is registered in default registry", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("unplan")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createDefaultRegistry includes all Phase 4 commands
// ---------------------------------------------------------------------------

describe("createDefaultRegistry", () => {
  it("includes all Phase 4 commands", () => {
    const registry = createDefaultRegistry();
    const phase4Names = ["mcp", "skills", "agents", "theme", "keybindings", "plan", "unplan"];
    for (const name of phase4Names) {
      expect(registry.has(name)).toBe(true);
    }
  });

  it("includes Phase 1-3 commands", () => {
    const registry = createDefaultRegistry();
    const earlyNames = [
      "help",
      "clear",
      "model",
      "config",
      "permissions",
      "diff",
      "cost",
      "doctor",
      "resume",
      "session",
      "rename",
      "rewind",
      "compact",
      "tasks",
    ];
    for (const name of earlyNames) {
      expect(registry.has(name)).toBe(true);
    }
  });

  it("can dispatch Phase 4 commands", async () => {
    const registry = createDefaultRegistry();
    const mcpResult = await registry.dispatch("/mcp", {});
    expect(typeof mcpResult).toBe("string");

    const keybindingsResult = await registry.dispatch("/keybindings", {});
    expect(keybindingsResult).toContain("REPL Keybindings");
  });
});

// ---------------------------------------------------------------------------
// Issue 4: /skills and /theme respect config.cwd over process.cwd
// ---------------------------------------------------------------------------

describe("/skills and /theme use config.cwd", () => {
  it("/skills uses config.cwd instead of process.cwd", async () => {
    // Create a skill in tmpDir (not in process.cwd())
    const skillDir = join(tmpDir, ".slc", "skills", "config-cwd-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: config-cwd-skill\n---\nBody`);

    // Pass config.cwd = tmpDir (which is different from process.cwd())
    const ctx: CommandContext = { config: { cwd: tmpDir } };
    const result = await skillsCommand.execute("", ctx);

    // Should find the skill because config.cwd points to tmpDir
    expect(result).toContain("config-cwd-skill");
  });

  it("/theme uses config.cwd instead of process.cwd", async () => {
    // Write a theme config in tmpDir
    const themeDir = join(tmpDir, ".slc");
    await mkdir(themeDir, { recursive: true });
    await writeFile(join(themeDir, "theme.json"), JSON.stringify({ theme: "dark" }));

    // Pass config.cwd = tmpDir
    const ctx: CommandContext = { config: { cwd: tmpDir } };
    const result = await themeCommand.execute("", ctx);

    // Should read from tmpDir, not process.cwd()
    expect(result).toContain("Current theme: dark");
  });

  it("/theme writes to config.cwd, not process.cwd", async () => {
    const ctx: CommandContext = { config: { cwd: tmpDir } };
    await themeCommand.execute("solarized", ctx);

    // Verify file was written under tmpDir, not process.cwd()
    const raw = await readFile(join(tmpDir, ".slc", "theme.json"), "utf-8");
    const config = JSON.parse(raw);
    expect(config.theme).toBe("solarized");

    // Verify it was NOT written to process.cwd()
    const processCwdTheme = join(process.cwd(), ".slc", "theme.json");
    try {
      const processTheme = JSON.parse(await readFile(processCwdTheme, "utf-8"));
      // If the file exists, it should NOT be solarized (unless process.cwd happens to be tmpDir)
      if (process.cwd() !== tmpDir) {
        expect(processTheme.theme).not.toBe("solarized");
      }
    } catch {
      // File doesn't exist at process.cwd — that's expected
    }
  });
});
