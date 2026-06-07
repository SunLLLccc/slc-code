import { describe, it, expect } from "vitest";
import {
  SlcError,
  toError,
  errorMessage,
  isAbortError,
} from "../src/utils/errors.js";

describe("errors", () => {
  describe("SlcError", () => {
    it("is an instance of Error", () => {
      const error = new SlcError("test");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SlcError);
    });

    it("has correct name property", () => {
      const error = new SlcError("test");
      expect(error.name).toBe("SlcError");
    });

    it("preserves message", () => {
      const error = new SlcError("something broke");
      expect(error.message).toBe("something broke");
    });

    it("supports error cause chain", () => {
      const cause = new Error("root cause");
      const error = new SlcError("wrapper", { cause });
      expect(error.cause).toBe(cause);
    });
  });

  describe("toError()", () => {
    it("returns Error as-is", () => {
      const original = new Error("original");
      expect(toError(original)).toBe(original);
    });

    it("converts string to Error", () => {
      const error = toError("string error");
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("string error");
    });

    it("converts number to Error", () => {
      const error = toError(42);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("42");
    });

    it("converts object to Error via String()", () => {
      const error = toError({ key: "val" });
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("[object Object]");
    });

    it("converts null to Error", () => {
      const error = toError(null);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("null");
    });

    it("preserves SlcError", () => {
      const original = new SlcError("slc");
      expect(toError(original)).toBe(original);
    });
  });

  describe("errorMessage()", () => {
    it("extracts message from Error", () => {
      expect(errorMessage(new Error("test msg"))).toBe("test msg");
    });

    it("returns string as-is", () => {
      expect(errorMessage("raw string")).toBe("raw string");
    });

    it("converts number to string", () => {
      expect(errorMessage(123)).toBe("123");
    });

    it("extracts message from SlcError", () => {
      expect(errorMessage(new SlcError("slc msg"))).toBe("slc msg");
    });
  });

  describe("isAbortError()", () => {
    it("returns true for DOMException with name AbortError", () => {
      const error = new DOMException("The operation was aborted", "AbortError");
      expect(isAbortError(error)).toBe(true);
    });

    it("returns true for Error with name AbortError", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      expect(isAbortError(error)).toBe(true);
    });

    it("returns false for regular Error", () => {
      expect(isAbortError(new Error("normal"))).toBe(false);
    });

    it("returns false for non-Error values", () => {
      expect(isAbortError("AbortError")).toBe(false);
      expect(isAbortError(null)).toBe(false);
      expect(isAbortError(undefined)).toBe(false);
    });
  });
});
