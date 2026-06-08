// Hook type definitions

export type HookType = "PreToolUse" | "PostToolUse" | "PreCompact" | "SessionStart";

export interface Hook {
  name: string;
  type: HookType;
  handler: (context: HookContext) => Promise<HookResult>;
}

export interface HookContext {
  toolName?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HookResult {
  action: "allow" | "deny" | "modify";
  reason?: string;
  modifiedInput?: Record<string, unknown>;
}
