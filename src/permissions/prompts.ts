import type { ToolInput } from "../tools/base.js";

export function formatPermissionPrompt(
  toolName: string,
  args: ToolInput,
  reason: string,
): string {
  return [
    `⚠ ${toolName}: ${reason}`,
    `Arguments: ${JSON.stringify(args)}`,
    "[Allow] [Deny] [Allow & Remember]",
  ].join("\n");
}
