// /theme — show/switch theme from config

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Command, CommandContext } from "../registry.js";

const VALID_THEMES = ["default", "light", "dark", "solarized"] as const;
type Theme = (typeof VALID_THEMES)[number];

const THEME_FILE = ".slc/theme.json";

interface ThemeConfig {
  theme: Theme;
}

async function readThemeConfig(cwd: string): Promise<ThemeConfig> {
  const path = join(cwd, THEME_FILE);
  if (!existsSync(path)) return { theme: "default" };
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as ThemeConfig;
  } catch {
    return { theme: "default" };
  }
}

async function writeThemeConfig(cwd: string, config: ThemeConfig): Promise<void> {
  const dir = join(cwd, ".slc");
  await mkdir(dir, { recursive: true });
  await writeFile(join(cwd, THEME_FILE), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export const themeCommand: Command = {
  name: "theme",
  description: "Show or switch theme",
  usage: "/theme [name]",
  execute: async (args: string, context: CommandContext): Promise<string> => {
    const cwd = (context.config?.cwd as string) ?? process.cwd();
    const themeName = args.trim().toLowerCase();

    if (!themeName) {
      const config = await readThemeConfig(cwd);
      return `Current theme: ${config.theme}\nAvailable: ${VALID_THEMES.join(", ")}`;
    }

    if (!VALID_THEMES.includes(themeName as Theme)) {
      return `Unknown theme "${themeName}". Available: ${VALID_THEMES.join(", ")}`;
    }

    await writeThemeConfig(cwd, { theme: themeName as Theme });
    return `Theme set to: ${themeName}`;
  },
};
