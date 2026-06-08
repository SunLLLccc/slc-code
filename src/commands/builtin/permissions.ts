// /permissions — manage permission rules

import type { Command, CommandContext } from "../registry.js";
import type { PermissionRule } from "../../permissions/rules.js";
import { parseRule } from "../../permissions/rules.js";

let rules: PermissionRule[] = [];

export function getPermissionRules(): PermissionRule[] {
  return rules;
}

export const permissionsCommand: Command = {
  name: "permissions",
  aliases: ["perms"],
  description: "Manage permission rules",
  usage: "/permissions [list|add <effect> <rule>|remove <index>]",

  execute(args: string, _context: CommandContext): string {
    const trimmed = args.trim();

    // list (default when no args)
    if (trimmed === "" || trimmed === "list") {
      if (rules.length === 0) {
        return "No permission rules configured.";
      }
      const lines = rules.map(
        (r, i) =>
          `  [${i}] ${r.effect} ${r.toolPattern}${
            r.argPattern !== "*" ? `(${r.argPattern})` : ""
          }`,
      );
      return `Permission rules:\n${lines.join("\n")}`;
    }

    // add <effect> <rule>
    if (trimmed.startsWith("add ")) {
      const rest = trimmed.slice(4).trim();
      const spaceIdx = rest.indexOf(" ");
      if (spaceIdx === -1) {
        return 'Usage: /permissions add <allow|deny|ask> <rule>';
      }
      const effect = rest.slice(0, spaceIdx).trim();
      const ruleStr = rest.slice(spaceIdx + 1).trim();

      if (effect !== "allow" && effect !== "deny" && effect !== "ask") {
        return `Invalid effect "${effect}". Must be allow, deny, or ask.`;
      }

      const rule = parseRule(ruleStr, effect);
      rules.push(rule);
      return `Added rule: ${rule.effect} ${rule.toolPattern}${
        rule.argPattern !== "*" ? `(${rule.argPattern})` : ""
      }`;
    }

    // remove <index>
    if (trimmed.startsWith("remove ")) {
      const indexStr = trimmed.slice(7).trim();
      const index = Number(indexStr);
      if (!Number.isInteger(index) || index < 0 || index >= rules.length) {
        return `Invalid index "${indexStr}". Must be 0–${rules.length - 1}.`;
      }
      const removed = rules.splice(index, 1)[0];
      return `Removed rule [${index}]: ${removed.effect} ${removed.toolPattern}${
        removed.argPattern !== "*" ? `(${removed.argPattern})` : ""
      }`;
    }

    return `Unknown subcommand. Usage: ${permissionsCommand.usage}`;
  },
};
