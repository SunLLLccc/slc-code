import { describe, it, expect } from "vitest";
import { sanitizeUnicode } from "../../src/security/unicode.js";

describe("sanitizeUnicode", () => {
  it("leaves normal text unchanged", () => {
    const input = "Hello, world! 123 abc";
    expect(sanitizeUnicode(input)).toBe(input);
  });

  it("removes zero-width space (U+200B)", () => {
    const input = "Hello​World";
    expect(sanitizeUnicode(input)).toBe("HelloWorld");
  });

  it("removes zero-width non-joiner (U+200C)", () => {
    const input = "Hello‌World";
    expect(sanitizeUnicode(input)).toBe("HelloWorld");
  });

  it("removes zero-width joiner (U+200D)", () => {
    const input = "Hello‍World";
    expect(sanitizeUnicode(input)).toBe("HelloWorld");
  });

  it("removes left-to-right mark (U+200E) and right-to-left mark (U+200F)", () => {
    const input = "Hello‎‏World";
    expect(sanitizeUnicode(input)).toBe("HelloWorld");
  });

  it("removes line separator (U+2028) and paragraph separator (U+2029 equivalent range)", () => {
    const input = "Line1 Line2";
    expect(sanitizeUnicode(input)).toBe("Line1Line2");
  });

  it("normalizes narrow no-break space (U+202F) to regular space via NFKC", () => {
    // U+202F is NFKC-normalized to a regular space before hidden-char stripping
    const input = "Hello World";
    expect(sanitizeUnicode(input)).toBe("Hello World");
  });

  it("removes BOM / zero-width no-break space (U+FEFF)", () => {
    const input = "﻿Hello";
    expect(sanitizeUnicode(input)).toBe("Hello");
  });

  it("removes tag characters (U+E0001..U+E007F)", () => {
    // U+E0001 is a language tag character
    const input = "Hello\u{E0001}World";
    expect(sanitizeUnicode(input)).toBe("HelloWorld");
  });

  it("applies NFKC normalization", () => {
    // U+2160 is Roman numeral one, NFKC normalizes to "I"
    const input = "Ⅰ";
    expect(sanitizeUnicode(input)).toBe("I");
  });

  it("applies NFKC normalization for fullwidth characters", () => {
    // U+FF21 is fullwidth A, NFKC normalizes to "A"
    const input = "Ａ";
    expect(sanitizeUnicode(input)).toBe("A");
  });

  describe("JSON string cleaning", () => {
    it("cleans hidden characters inside JSON string values", () => {
      const input = JSON.stringify({ key: "Hello​World" });
      const result = sanitizeUnicode(input);
      const parsed = JSON.parse(result);
      expect(parsed.key).toBe("HelloWorld");
    });

    it("cleans nested JSON objects", () => {
      const input = JSON.stringify({
        outer: { inner: "Hidden​Char" },
      });
      const result = sanitizeUnicode(input);
      const parsed = JSON.parse(result);
      expect(parsed.outer.inner).toBe("HiddenChar");
    });

    it("cleans JSON arrays", () => {
      const input = JSON.stringify(["a​b", "c​d"]);
      const result = sanitizeUnicode(input);
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(["ab", "cd"]);
    });

    it("does not alter non-JSON text", () => {
      const input = "Not json { at all";
      expect(sanitizeUnicode(input)).toBe(input);
    });
  });

  describe("max iterations safety", () => {
    it("caps JSON cleaning at 10 levels of depth", () => {
      // Build a deeply nested object (20 levels)
      let obj: Record<string, unknown> = { value: "deep" };
      for (let i = 0; i < 20; i++) {
        obj = { child: obj };
      }
      const input = JSON.stringify(obj);
      // Should not throw and should return valid JSON
      const result = sanitizeUnicode(input);
      const parsed = JSON.parse(result);
      // The deepest value should still be accessible
      let current: Record<string, unknown> = parsed;
      for (let i = 0; i < 20; i++) {
        current = current.child as Record<string, unknown>;
      }
      expect(current.value).toBe("deep");
    });
  });
});
