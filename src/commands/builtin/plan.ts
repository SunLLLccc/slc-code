// /plan — enter plan mode via shared plan-mode state

import type { Command, CommandContext } from "../registry.js";
import { getPlanModeState, setPlanModeState } from "../../tools/builtin/plan-mode.js";

export const planCommand: Command = {
  name: "plan",
  description: "Enter plan mode",
  execute(_args: string, context: CommandContext): string {
    const state = getPlanModeState();
    if (state.active) {
      return "Already in plan mode. Use /unplan to exit.";
    }

    // Save the real current permission mode from runtime config
    const currentMode = (context.config?.permissionMode as string) ?? state.baseMode ?? "default";

    // Actually enter plan mode
    setPlanModeState({
      active: true,
      previousMode: currentMode,
      baseMode: currentMode,
    });
    return "Entered plan mode. Only read-only tools are allowed. Use /unplan to exit.";
  },
};
