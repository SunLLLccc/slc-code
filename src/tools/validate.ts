// Lightweight JSON Schema validator for tool input
// Covers: required, type, properties, additionalProperties
// No external dependencies — just enough for P5 tool validation.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationError {
  path: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate a value against a simplified JSON Schema.
 * Returns an array of validation errors (empty = valid).
 */
export function validateSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = "",
): ValidationError[] {
  const errors: ValidationError[] = [];

  // type check
  if (schema.type) {
    const expected = schema.type as string;
    if (!checkType(value, expected)) {
      errors.push({
        path: path || "$",
        message: `Expected type ${expected}, got ${typeof value}`,
      });
      return errors; // type mismatch → stop further checks
    }
  }

  // Only check properties for objects
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;

    // required
    const required = schema.required as string[] | undefined;
    if (required) {
      for (const field of required) {
        if (!(field in obj)) {
          errors.push({
            path: `${path}.${field}`,
            message: `Missing required field: ${field}`,
          });
        }
      }
    }

    // additionalProperties
    if (schema.additionalProperties === false && properties) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) {
          errors.push({
            path: `${path}.${key}`,
            message: `Unknown field: ${key}`,
          });
        }
      }
    }

    // recurse into properties
    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in obj) {
          const nested = validateSchema(obj[key], propSchema, `${path}.${key}`);
          errors.push(...nested);
        }
      }
    }
  }

  return errors;
}

function checkType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}
