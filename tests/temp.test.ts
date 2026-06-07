import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { createTempDir } from "./helpers/temp.js";

describe("temp helpers", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  describe("createTempDir()", () => {
    it("creates a temporary directory that exists", () => {
      const { dir, cleanup: clean } = createTempDir();
      cleanup = clean;
      expect(existsSync(dir)).toBe(true);
    });

    it("uses custom prefix", () => {
      const { dir, cleanup: clean } = createTempDir("my-prefix-");
      cleanup = clean;
      expect(dir).toContain("my-prefix-");
      expect(existsSync(dir)).toBe(true);
    });

    it("cleanup removes the directory", () => {
      const { dir, cleanup: clean } = createTempDir();
      expect(existsSync(dir)).toBe(true);
      clean();
      expect(existsSync(dir)).toBe(false);
    });

    it("cleanup does not throw on double cleanup", () => {
      const { dir, cleanup: clean } = createTempDir();
      clean();
      expect(() => clean()).not.toThrow();
    });
  });
});
