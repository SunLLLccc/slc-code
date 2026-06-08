import type { Tool } from "../tools/base.js";
import type { PermissionDecision } from "../tools/base.js";

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "auto"
  | "bypassPermissions";

export function checkModePermission(
  mode: PermissionMode,
  tool: Tool,
): PermissionDecision {
  switch (mode) {
    case "plan":
      return tool.security.readOnly ? "allow" : "deny";
    case "default":
      return tool.security.readOnly ? "allow" : "ask";
    case "acceptEdits": {
      if (tool.security.readOnly) return "allow";
      const name = tool.name;
      if (name.startsWith("File") || name.startsWith("file")) return "allow";
      return "ask";
    }
    case "auto":
      return "ask";
    case "bypassPermissions":
      return "allow";
  }
}
