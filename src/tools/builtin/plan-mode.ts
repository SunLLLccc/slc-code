// Plan mode tools — EnterPlanMode and ExitPlanMode with real permission switching

import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";

// ---------------------------------------------------------------------------
// Shared plan mode state — module-level singleton
// ---------------------------------------------------------------------------

interface PlanModeState {
  active: boolean;
  previousMode: string;
  /** The base (non-plan) mode — set by /plan from the real runtime mode. */
  baseMode: string;
}

const state: PlanModeState = {
  active: false,
  previousMode: "default",
  baseMode: "default",
};

/** Get the current plan mode state (for testing and commands). */
export function getPlanModeState(): Readonly<PlanModeState> {
  return state;
}

/** Reset plan mode state (for testing). */
export function resetPlanModeState(): void {
  state.active = false;
  state.previousMode = "default";
  state.baseMode = "default";
}

/** Set plan mode state directly (for /plan and /unplan commands). */
export function setPlanModeState(newState: Partial<PlanModeState>): void {
  if (newState.active !== undefined) state.active = newState.active;
  if (newState.previousMode !== undefined) state.previousMode = newState.previousMode;
  if (newState.baseMode !== undefined) state.baseMode = newState.baseMode;
}

/**
 * Get the effective permission mode for runtime.
 * Returns "plan" when plan mode is active, otherwise returns baseMode.
 * Used by the permission checker's getRuntimeMode callback.
 */
export function getRuntimePermissionMode(): string {
  return state.active ? "plan" : state.baseMode;
}

// ---------------------------------------------------------------------------
// EnterPlanMode
// ---------------------------------------------------------------------------

export const enterPlanModeTool: Tool = buildTool({
  name: "EnterPlanMode",
  description: "Enter plan mode — only read-only tools allowed",
  security: {
    readOnly: true,
    concurrencySafe: true,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {},
    },
  },
  async execute(_input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    if (state.active) {
      return { output: "Already in plan mode" };
    }

    // Save current mode and switch to plan
    state.previousMode = context.permissionMode ?? "default";
    state.active = true;

    return {
      output: `Entered plan mode. Previous mode: ${state.previousMode}. Only read-only tools are allowed.`,
      contextModifier: { permissionMode: "plan" },
    };
  },
});

// ---------------------------------------------------------------------------
// ExitPlanMode
// ---------------------------------------------------------------------------

export const exitPlanModeTool: Tool = buildTool({
  name: "ExitPlanMode",
  description: "Exit plan mode — restore previous permission mode",
  security: {
    readOnly: true,
    concurrencySafe: true,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {},
    },
  },
  async execute(_input: ToolInput, _context: ToolContext): Promise<ToolOutput> {
    if (!state.active) {
      return { output: "Not in plan mode" };
    }

    const restoredMode = state.previousMode;
    state.active = false;

    return {
      output: `Exited plan mode. Restored mode: ${restoredMode}.`,
      contextModifier: { permissionMode: restoredMode },
    };
  },
});
