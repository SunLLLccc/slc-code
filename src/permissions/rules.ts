import type { ToolInput } from "../tools/base.js";

export type RuleEffect = "allow" | "deny" | "ask";

export interface PermissionRule {
  effect: RuleEffect;
  toolPattern: string;
  argPattern: string;
}

export function parseRule(input: string, effect: RuleEffect): PermissionRule {
  const trimmed = input.trim();

  if (trimmed === "*") {
    return { effect, toolPattern: "*", argPattern: "*" };
  }

  const parenIdx = trimmed.indexOf("(");
  if (parenIdx === -1) {
    return { effect, toolPattern: trimmed, argPattern: "*" };
  }

  const toolPattern = trimmed.slice(0, parenIdx);
  const inner = trimmed.slice(parenIdx + 1);
  if (!inner.endsWith(")")) {
    return { effect, toolPattern, argPattern: inner };
  }

  const argPattern = inner.slice(0, -1);
  return { effect, toolPattern, argPattern };
}

function matchPattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(":*")) {
    // "prefix:*" matches values starting with "prefix"
    const prefix = pattern.slice(0, -2);
    return value.startsWith(prefix);
  }
  if (pattern.startsWith("*")) {
    const suffix = pattern.slice(1);
    return value.endsWith(suffix);
  }
  return pattern === value;
}

export function matchRule(
  rule: PermissionRule,
  toolName: string,
  args: ToolInput,
): boolean {
  if (!matchPattern(rule.toolPattern, toolName)) return false;
  if (rule.argPattern === "*") return true;

  const argValues = Object.values(args);
  for (const val of argValues) {
    if (typeof val === "string" && matchPattern(rule.argPattern, val)) {
      return true;
    }
  }

  return false;
}

export function evaluateRules(
  rules: PermissionRule[],
  toolName: string,
  args: ToolInput,
): RuleEffect | null {
  const denyRules = rules.filter((r) => r.effect === "deny");
  for (const rule of denyRules) {
    if (matchRule(rule, toolName, args)) return "deny";
  }

  const askRules = rules.filter((r) => r.effect === "ask");
  for (const rule of askRules) {
    if (matchRule(rule, toolName, args)) return "ask";
  }

  const allowRules = rules.filter((r) => r.effect === "allow");
  for (const rule of allowRules) {
    if (matchRule(rule, toolName, args)) return "allow";
  }

  return null;
}
