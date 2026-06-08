// Secret scanning and redaction

export interface SecretMatch {
  rule: string;
  redacted: string;
  startIndex: number;
  endIndex: number;
}

export interface ScanResult {
  cleanText: string;
  matches: SecretMatch[];
}

interface DetectionRule {
  name: string;
  pattern: RegExp;
}

const RULES: DetectionRule[] = [
  { name: "openai_key",    pattern: /sk-[a-zA-Z0-9]{20,}/g },
  { name: "anthropic_key", pattern: /sk-ant-[a-zA-Z0-9]{20,}/g },
  { name: "github_token",  pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
  { name: "aws_key",       pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "generic_api_key", pattern: /api[_-]?key[=:]?\s*["']?[a-zA-Z0-9]{20,}/gi },
];

/**
 * Scan text for secret patterns and return a redacted version.
 * The returned `cleanText` has all matches replaced with `[REDACTED:<rule>]`.
 * `matches` provides metadata about each detected secret (never the full secret).
 */
export function scanAndRedact(text: string): ScanResult {
  // Collect all matches across all rules
  const allMatches: SecretMatch[] = [];

  for (const rule of RULES) {
    // Reset lastIndex for global regexes
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text)) !== null) {
      allMatches.push({
        rule: rule.name,
        redacted: `[REDACTED:${rule.name}]`,
        startIndex: m.index,
        endIndex: m.index + m[0].length,
      });
    }
  }

  if (allMatches.length === 0) {
    return { cleanText: text, matches: [] };
  }

  // Sort by start index descending so we can splice from the end
  allMatches.sort((a, b) => b.startIndex - a.startIndex);

  let cleanText = text;
  for (const match of allMatches) {
    cleanText =
      cleanText.slice(0, match.startIndex) +
      match.redacted +
      cleanText.slice(match.endIndex);
  }

  // Reverse matches back to document order for the caller
  allMatches.reverse();

  return { cleanText, matches: allMatches };
}
