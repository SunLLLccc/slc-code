import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr, type Result } from "../src/utils/result.js";

describe("result", () => {
  describe("ok()", () => {
    it("creates a success result", () => {
      const result = ok(42);
      expect(result).toEqual({ ok: true, value: 42 });
    });

    it("works with string values", () => {
      const result = ok("hello");
      expect(result).toEqual({ ok: true, value: "hello" });
    });

    it("works with object values", () => {
      const result = ok({ name: "test", count: 1 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("test");
      }
    });

    it("works with null and undefined", () => {
      expect(ok(null)).toEqual({ ok: true, value: null });
      expect(ok(undefined)).toEqual({ ok: true, value: undefined });
    });
  });

  describe("err()", () => {
    it("creates an error result", () => {
      const result = err("something went wrong");
      expect(result).toEqual({ ok: false, error: "something went wrong" });
    });

    it("works with Error objects", () => {
      const error = new Error("fail");
      const result = err(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe("isOk()", () => {
    it("returns true for success results", () => {
      expect(isOk(ok(1))).toBe(true);
    });

    it("returns false for error results", () => {
      expect(isOk(err("fail"))).toBe(false);
    });

    it("narrows the type", () => {
      const result: Result<number, string> = ok(42);
      if (isOk(result)) {
        expect(result.value).toBe(42);
      }
    });
  });

  describe("isErr()", () => {
    it("returns true for error results", () => {
      expect(isErr(err("fail"))).toBe(true);
    });

    it("returns false for success results", () => {
      expect(isErr(ok(1))).toBe(false);
    });

    it("narrows the type", () => {
      const result: Result<number, string> = err("oops");
      if (isErr(result)) {
        expect(result.error).toBe("oops");
      }
    });
  });

  describe("Result type usage", () => {
    function divide(a: number, b: number): Result<number, string> {
      if (b === 0) return err("division by zero");
      return ok(a / b);
    }

    it("handles success path", () => {
      const result = divide(10, 2);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(5);
      }
    });

    it("handles error path", () => {
      const result = divide(10, 0);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe("division by zero");
      }
    });
  });
});
