// Base error class and utilities for slc-code

export class SlcError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SlcError";
  }
}

/**
 * Safely convert an unknown thrown value to an Error object.
 */
export function toError(thrown: unknown): Error {
  if (thrown instanceof Error) {
    return thrown;
  }
  if (typeof thrown === "string") {
    return new Error(thrown);
  }
  return new Error(String(thrown));
}

/**
 * Extract a human-readable error message from an unknown thrown value.
 */
export function errorMessage(thrown: unknown): string {
  if (thrown instanceof Error) {
    return thrown.message;
  }
  if (typeof thrown === "string") {
    return thrown;
  }
  return String(thrown);
}

/**
 * Check if an error is an AbortError (from AbortController.signal).
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  return false;
}
