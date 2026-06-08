// /doctor — run environment diagnostics

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Command, CommandContext } from "../registry.js";

function check(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { encoding: "utf-8", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export const doctorCommand: Command = {
  name: "doctor",
  description: "Run environment diagnostics",

  execute(_args: string, _context: CommandContext): string {
    try {
      const lines: string[] = ["slc environment diagnostics:", ""];

      // 1. Node.js version
      const nodeVersion = process.version;
      const major = parseInt(nodeVersion.replace(/^v/, "").split(".")[0] ?? "0", 10);
      const nodeOk = major >= 22;
      lines.push(
        `  Node.js: ${nodeVersion} ${nodeOk ? "OK" : "WARNING: version >= 22.0.0 required"}`,
      );

      // 2. Configuration path
      const configDir = join(homedir(), ".slc");
      lines.push(`  Config directory: ${configDir}`);

      // 3. Provider configuration
      const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
      const hasOpenAI = !!process.env.OPENAI_API_KEY;
      const providers: string[] = [];
      if (hasAnthropic) providers.push("Anthropic");
      if (hasOpenAI) providers.push("OpenAI");
      lines.push(
        `  Provider: ${providers.length > 0 ? providers.join(", ") + " configured" : "not set"}`,
      );

      // 4. Sandbox availability
      const platform = process.platform;
      if (platform === "darwin") {
        lines.push(`  Sandbox: ${check("which", ["sandbox-exec"]) ? "sandbox-exec available" : "sandbox-exec not found"}`);
      } else if (platform === "linux") {
        lines.push(`  Sandbox: ${check("which", ["bwrap"]) ? "bwrap available" : "bwrap not found"}`);
      } else {
        lines.push("  Sandbox: not available (application-level only)");
      }

      // 5. ripgrep availability
      lines.push(`  ripgrep (rg): ${check("which", ["rg"]) ? "available" : "not found"}`);

      // 6. Permission file
      const settingsPath = join(configDir, "settings.json");
      if (existsSync(settingsPath)) {
        try {
          readFileSync(settingsPath, "utf-8");
          lines.push(`  Settings file: ${settingsPath} (readable)`);
        } catch {
          lines.push(`  Settings file: ${settingsPath} (exists but not readable)`);
        }
      } else {
        lines.push(`  Settings file: not found at ${settingsPath}`);
      }

      return lines.join("\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Diagnostics failed: ${message}`;
    }
  },
};
