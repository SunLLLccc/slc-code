// /unplan — exit plan mode via shared plan-mode state

import type { Command, CommandContext } from "../registry.js";
import { getPlanModeState, setPlanModeState } from "../../tools/builtin/plan-mode.js";

export const unplanCommand: Command = {
  name: "unplan",
  description: "Exit plan mode",
  execute(_args: string, _context: CommandContext): string {
    const state = getPlanModeState();
    if (!state.active) {
      return "Not in plan mode. Use /plan to enter.";
    }

    // Restore to the saved previous mode
    const previousMode = state.previousMode ?? "default";
    setPlanModeState({ active: false, previousMode: "default", baseMode: previousMode });
    return `Exited plan mode. Restored to: ${previousMode}.`;
  },
};
