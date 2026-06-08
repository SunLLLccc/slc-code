// Unicode sanitization — removes hidden/dangerous characters

const MAX_ITERATIONS = 10;

/**
 * Matches hidden / directional / format characters that should be stripped:
 * U+200B (zero-width space), U+200C..U+200F (format controls),
 * U+2028..U+202F (line/para separators, narrow no-break space, etc.),
 * U+FEFF (BOM / zero-width no-break space).
 */
function isHiddenChar(cp: number): boolean {
  return (
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202f) ||
    cp === 0xfeff
  );
}

/** Matches Tag characters U+E0001..U+E007F. */
function isTagChar(cp: number): boolean {
  return cp >= 0xe0001 && cp <= 0xe007f;
}

/** Remove hidden and tag characters from a string. */
function stripChars(text: string): string {
  let result = "";
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (!isHiddenChar(cp) && !isTagChar(cp)) {
      result += char;
    }
  }
  return result;
}

/**
 * Sanitize text by applying NFKC normalization and removing hidden characters.
 * If the text is valid JSON, recursively cleans string values within it.
 */
export function sanitizeUnicode(text: string): string {
  // Step 1: NFKC normalize
  let result = text.normalize("NFKC");

  // Step 2: Strip hidden / tag characters
  result = stripChars(result);

  // Step 3: Try to clean JSON strings recursively
  result = cleanJsonStrings(result);

  return result;
}

/**
 * If the input is valid JSON, recursively clean all string values.
 * Loop-protection caps at MAX_ITERATIONS.
 */
function cleanJsonStrings(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }

  return JSON.stringify(cleanValue(parsed, 0));
}

function cleanValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_ITERATIONS) return value;

  if (typeof value === "string") {
    return stripChars(value.normalize("NFKC"));
  }

  if (Array.isArray(value)) {
    return value.map((item) => cleanValue(item, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      // Clean both keys and values (PRD 16.1: all strings including keys)
      const cleanedKey = stripChars(k.normalize("NFKC"));
      cleaned[cleanedKey] = cleanValue(v, depth + 1);
    }
    return cleaned;
  }

  return value;
}
