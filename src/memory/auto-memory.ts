import type { MemoryEntry } from "./recall.js";

interface PatternRule {
  pattern: RegExp;
  type: MemoryEntry["metadata"]["type"];
}

const PATTERNS: PatternRule[] = [
  // English patterns (relaxed capture range from original {10,80} to {3,120})
  { pattern: /I prefer\s+(.{3,120})/i, type: "user" },
  { pattern: /always use\s+(.{3,120})/i, type: "user" },
  { pattern: /don't use\s+(.{3,120})/i, type: "user" },
  { pattern: /please (?:always\s+)?(?:use|prefer)\s+(.{3,120})/i, type: "user" },
  { pattern: /the project uses\s+(.{3,120})/i, type: "project" },
  { pattern: /we use\s+(.{3,120})/i, type: "project" },
  { pattern: /(?:our|the)\s+(?:convention|standard|style)\s+is\s+(.{3,120})/i, type: "project" },
  { pattern: /(?:next time|in the future),?\s+(.{3,120})/i, type: "feedback" },
  { pattern: /instead of .{3,40},?\s+(?:please\s+)?(.{3,120})/i, type: "feedback" },
  // Chinese patterns
  { pattern: /(?:^|[，,\n])\s*记住[，,]?\s*(.{2,120})/, type: "user" },
  { pattern: /以后(?:请|要|都|用|说|给我)(.{2,120})/, type: "user" },
  { pattern: /我(?:喜欢|偏好|习惯|希望)(.{2,120})/, type: "user" },
  { pattern: /请(?:记住|记得|用|说|永远)(.{2,120})/, type: "feedback" },
];

/**
 * Simple djb2 hash for generating stable filenames from content.
 */
function contentHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/**
 * Extract memories from user message text using simple heuristics.
 */
export function extractMemories(userMessage: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const seen = new Set<string>();

  for (const rule of PATTERNS) {
    const matches = userMessage.matchAll(new RegExp(rule.pattern, "gi"));
    for (const match of matches) {
      const extracted = match[1]?.trim();
      if (!extracted) continue;

      // Deduplicate by lowercase content
      const key = extracted.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      // Use content hash for stable, unique filenames (no overwrites across conversations)
      entries.push({
        name: `auto-${rule.type}-${contentHash(key)}`,
        description: `Extracted from conversation`,
        content: extracted,
        metadata: { type: rule.type },
      });
    }
  }

  return entries;
}
