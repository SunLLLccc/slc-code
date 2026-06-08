import type { MemoryEntry } from "./recall.js";

interface PatternRule {
  pattern: RegExp;
  type: MemoryEntry["metadata"]["type"];
}

const PATTERNS: PatternRule[] = [
  { pattern: /I prefer\s+(.{10,80})/i, type: "user" },
  { pattern: /always use\s+(.{10,80})/i, type: "user" },
  { pattern: /don't use\s+(.{10,80})/i, type: "user" },
  { pattern: /please (?:always\s+)?(?:use|prefer)\s+(.{10,80})/i, type: "user" },
  { pattern: /the project uses\s+(.{10,80})/i, type: "project" },
  { pattern: /we use\s+(.{10,80})/i, type: "project" },
  { pattern: /(?:our|the)\s+(?:convention|standard|style)\s+is\s+(.{10,80})/i, type: "project" },
  { pattern: /(?:next time|in the future),?\s+(.{10,80})/i, type: "feedback" },
  { pattern: /instead of .{5,40},?\s+(?:please\s+)?(.{10,80})/i, type: "feedback" },
];

/**
 * Extract memories from conversation text using simple heuristics.
 *
 * This is a placeholder implementation. A production version would
 * use an LLM to extract memories more accurately.
 */
export function extractMemories(conversation: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const seen = new Set<string>();

  for (const rule of PATTERNS) {
    const matches = conversation.matchAll(new RegExp(rule.pattern, "gi"));
    for (const match of matches) {
      const extracted = match[1]?.trim();
      if (!extracted) continue;

      // Deduplicate by lowercase content
      const key = extracted.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      entries.push({
        name: `auto-${rule.type}-${entries.length}`,
        description: `Extracted from conversation`,
        content: extracted,
        metadata: { type: rule.type },
      });
    }
  }

  return entries;
}
